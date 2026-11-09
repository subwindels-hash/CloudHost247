/**
 * Customer-facing Email Trace & Forensics Analyzer API (`/api/v1/email-forensics*`).
 *
 * Every handler authenticates first, then scopes every read to the caller's own user id. A
 * forensics record that belongs to another customer is 404, never 403 — this API never confirms
 * that another customer's analysis exists. Raw email content is never returned to anyone but the
 * owner, and never stored as a body/attachment — only header-derived evidence is persisted.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors';
import { parseOrThrow, analyzeBodySchema, historyQuerySchema, reportFormatSchema } from '../email-forensics/validation';
import { runAnalysis } from '../email-forensics/service';
import {
  findAnalysis, listAnalyses, deleteAnalysis,
  listIpCandidates, listRouteHops, listAuthResults,
  listDatabaseVersions,
} from '../db/email-forensics';
import { writeAuditLog } from '../db/email-forensics';
import { recordAuditBestEffort, requestAuditContext } from '../lib/audit';

const MAX_UPLOAD_BYTES = (() => {
  const n = Number(process.env.EMAIL_FORENSICS_MAX_FILE_SIZE);
  return Number.isFinite(n) && n > 0 ? n : 5_000_000;
})();

/** Accepted upload content types for an .eml / raw-header file. */
const ACCEPTED_TYPES = new Set([
  'message/rfc822',
  'text/plain',
  'application/octet-stream',
]);

export async function registerEmailForensicsCustomerRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable
) {
  if (!env.EMAIL_FORENSICS_ENABLED) return;
  const pool = overridePool ?? getPool(env);

  // Accept raw upload bodies for the .eml / text file endpoint so Fastify does not try to
  // parse them as JSON.
  app.addContentTypeParser(
    'message/rfc822',
    { parseAs: 'string' },
    (_req: FastifyRequest, body: string) => body,
  );
  app.addContentTypeParser(
    'text/plain',
    { parseAs: 'string' },
    (_req: FastifyRequest, body: string) => body,
  );

  // ------------------------------------------------------------------
  // POST /api/v1/email-forensics/analyze — paste raw headers
  // ------------------------------------------------------------------
  app.post('/api/v1/email-forensics/analyze', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const body = parseOrThrow(analyzeBodySchema, request.body);

    let result;
    try {
      result = await runAnalysis(pool, {
        rawHeaders: body.rawHeaders,
        originalFilename: null,
        userId: auth.userId,
      });
    } catch (err) {
      await recordAuditBestEffort(pool, {
        actorId: auth.userId,
        action: 'email_forensics.analyze_failed',
        resourceType: 'email_forensic_analysis',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      }, requestAuditContext(request));
      throw err;
    }

    await recordAuditBestEffort(pool, {
      actorId: auth.userId,
      action: 'email_forensics.analyze',
      resourceType: 'email_forensic_analysis',
      resourceId: result.analysisReference,
      metadata: { input: 'pasted_headers', candidateCount: result.sourceIpAnalysis.candidates.length },
    }, requestAuditContext(request));

    return reply.send(result);
  });

  // ------------------------------------------------------------------
  // POST /api/v1/email-forensics/analyze-file — upload .eml / raw-header file
  // ------------------------------------------------------------------
  app.post('/api/v1/email-forensics/analyze-file', async (request, reply) => {
    const auth = await authenticate(request, env, pool);

    const contentType = request.headers['content-type'];
    const mimeType = typeof contentType === 'string' ? (contentType.split(';')[0]?.trim().toLowerCase() ?? '') : '';
    const isSupportedType = ACCEPTED_TYPES.has(mimeType);
    if (!isSupportedType) {
      throw new ValidationError('Only .eml (.message/rfc822) or .txt (text/plain) email files are accepted');
    }

    const body = request.body;
    if (typeof body !== 'string') throw new ValidationError('Could not read the uploaded file');

    const nameHeader = request.headers['x-filename'] ?? request.headers['x-original-filename'];
    let originalFilename: string | null =
      typeof nameHeader === 'string' && nameHeader.length > 0 ? nameHeader : 'upload.eml';
    if (!/\.eml$/i.test(originalFilename) && !/\.txt$/i.test(originalFilename)) {
      throw new ValidationError('Only .eml or .txt email files are accepted');
    }

    // Size cap on the upload body.
    if (Buffer.byteLength(body, 'utf8') > MAX_UPLOAD_BYTES) {
      throw new ValidationError('File exceeds the maximum allowed size');
    }

    if (body.trim() === '') throw new ValidationError('Could not read the uploaded file');

    const fileContent = body;

    let result;
    try {
      result = await runAnalysis(pool, {
        rawHeaders: fileContent,
        originalFilename,
        userId: auth.userId,
      });
    } catch (err) {
      await recordAuditBestEffort(pool, {
        actorId: auth.userId,
        action: 'email_forensics.analyze_file_failed',
        resourceType: 'email_forensic_analysis',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      }, requestAuditContext(request));
      throw err;
    }

    await recordAuditBestEffort(pool, {
      actorId: auth.userId,
      action: 'email_forensics.analyze_file',
      resourceType: 'email_forensic_analysis',
      resourceId: result.analysisReference,
      metadata: { input: 'uploaded_file', originalFilename, candidateCount: result.sourceIpAnalysis.candidates.length },
    }, requestAuditContext(request));

    return reply.send(result);
  });

  // ------------------------------------------------------------------
  // GET /api/v1/email-forensics/history — own analyses, newest first
  // ------------------------------------------------------------------
  app.get('/api/v1/email-forensics/history', async (request) => {
    const auth = await authenticate(request, env, pool);
    const query = parseOrThrow(historyQuerySchema, request.query);
    const { analyses, total, limit, offset } = await listAnalyses(
      pool,
      { status: query.status, limit: query.limit, offset: query.offset },
      { userIds: [auth.userId] }
    );

    await recordAuditBestEffort(pool, {
      actorId: auth.userId,
      action: 'email_forensics.history_view',
      resourceType: 'email_forensic_analysis',
      metadata: { resultCount: analyses.length },
    }, requestAuditContext(request));

    return {
      analyses: analyses.map((row) => ({
        id: row.id,
        analysisReference: row.analysis_reference,
        originalFilename: row.original_filename,
        subject: row.subject,
        sender: row.sender,
        senderDomain: row.sender_domain,
        recipient: row.recipient,
        receivedAt: row.received_at?.toISOString() ?? null,
        status: row.analysis_status,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      })),
      total, limit, offset,
    };
  });

  // ------------------------------------------------------------------
  // GET /api/v1/email-forensics/history/:id — detail for one analysis (owner only)
  // ------------------------------------------------------------------
  app.get('/api/v1/email-forensics/history/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const analysis = await findAnalysis(pool, params.id, { userIds: [auth.userId] });
    if (!analysis) throw new NotFoundError('Analysis not found');

    const [candidates, hops, auths] = await Promise.all([
      listIpCandidates(pool, analysis.id),
      listRouteHops(pool, analysis.id),
      listAuthResults(pool, analysis.id),
    ]);

    await recordAuditBestEffort(pool, {
      actorId: auth.userId,
      action: 'email_forensics.detail_view',
      resourceType: 'email_forensic_analysis',
      resourceId: analysis.analysis_reference,
    }, requestAuditContext(request));

    return {
      id: analysis.id,
      analysisReference: analysis.analysis_reference,
      originalFilename: analysis.original_filename,
      subject: analysis.subject,
      sender: analysis.sender,
      senderDomain: analysis.sender_domain,
      recipient: analysis.recipient,
      receivedAt: analysis.received_at?.toISOString() ?? null,
      status: analysis.analysis_status,
      createdAt: analysis.created_at.toISOString(),
      expiresAt: analysis.expires_at.toISOString(),
      sourceIpCandidates: candidates.map((c) => ({
        ipAddress: c.ipAddress, ipVersion: c.ipVersion, sourceHeader: c.sourceHeader,
        hopNumber: c.hopNumber, addressClass: c.addressClass,
        trustClassification: c.trustClassification, confidenceLevel: c.confidenceLevel,
      })),
      routeHops: hops.map((h) => ({
        hopNumber: h.hopNumber, hostname: h.hostname, ipAddress: h.ipAddress,
        receivedTimestamp: h.receivedTimestamp?.toISOString() ?? null,
        tlsInformation: h.tlsInformation, trustClassification: h.trustClassification,
      })),
      authentication: auths.map((a) => ({
        authenticationType: a.authenticationType, reportedResult: a.reportedResult,
        independentlyVerified: a.independentlyVerified, explanation: a.explanation,
      })),
    };
  });

  // ------------------------------------------------------------------
  // DELETE /api/v1/email-forensics/history/:id — delete own analysis
  // ------------------------------------------------------------------
  app.delete('/api/v1/email-forensics/history/:id', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const analysis = await findAnalysis(pool, params.id, { userIds: [auth.userId] });
    if (!analysis) throw new NotFoundError('Analysis not found');

    const deleted = await deleteAnalysis(pool, params.id, { userIds: [auth.userId] });
    if (!deleted) throw new NotFoundError('Analysis not found');

    await recordAuditBestEffort(pool, {
      actorId: auth.userId,
      action: 'email_forensics.delete',
      resourceType: 'email_forensic_analysis',
      resourceId: analysis.analysis_reference,
    }, requestAuditContext(request));

    return reply.code(204).send();
  });

  // ------------------------------------------------------------------
  // GET /api/v1/email-forensics/report/:id — PDF or JSON download (owner only)
  // ------------------------------------------------------------------
  app.get('/api/v1/email-forensics/report/:id', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const format = parseOrThrow(reportFormatSchema, request.query);
    const analysis = await findAnalysis(pool, params.id, { userIds: [auth.userId] });
    if (!analysis) throw new NotFoundError('Analysis not found');
    if (analysis.analysis_status !== 'complete') throw new ForbiddenError('Analysis is not complete');

    const [candidates, hops, auths] = await Promise.all([
      listIpCandidates(pool, analysis.id),
      listRouteHops(pool, analysis.id),
      listAuthResults(pool, analysis.id),
    ]);

    const report = {
      analysisReference: analysis.analysis_reference,
      generatedAt: new Date().toISOString(),
      emailOverview: {
        sender: analysis.sender,
        recipient: analysis.recipient,
        subject: analysis.subject,
        messageId: analysis.message_id,
        sendingDomain: analysis.sender_domain,
      },
      sourceIpCandidates: candidates.map((c) => ({
        ipAddress: c.ipAddress, ipVersion: c.ipVersion, sourceHeader: c.sourceHeader,
        hopNumber: c.hopNumber, addressClass: c.addressClass,
        trustClassification: c.trustClassification, confidenceLevel: c.confidenceLevel,
      })),
      routeHops: hops.map((h) => ({
        hopNumber: h.hopNumber, hostname: h.hostname, ipAddress: h.ipAddress,
        receivedTimestamp: h.receivedTimestamp?.toISOString() ?? null,
        tlsInformation: h.tlsInformation, trustClassification: h.trustClassification,
      })),
      authentication: auths.map((a) => ({
        authenticationType: a.authenticationType, reportedResult: a.reportedResult,
        independentlyVerified: a.independentlyVerified, explanation: a.explanation,
      })),
      limitations: [
        'This is not a legally certified forensic report.',
        'IP geolocation is approximate and comes from a locally stored database.',
        "The analyzer cannot guarantee recovery of the sender's original device IP.",
      ],
    };

    await recordAuditBestEffort(pool, {
      actorId: auth.userId,
      action: 'email_forensics.report_download',
      resourceType: 'email_forensic_analysis',
      resourceId: analysis.analysis_reference,
      metadata: { format: format.format },
    }, requestAuditContext(request));

    if (format.format === 'json') {
      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="forensics-${analysis.analysis_reference}.json"`)
        .send(JSON.stringify(report, null, 2));
    }

    const pdf = buildPdfReport(report);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="forensics-${analysis.analysis_reference}.pdf"`)
      .send(pdf);
  });

  // ------------------------------------------------------------------
  // GET /api/v1/email-forensics/database-status — local IP intelligence version
  // ------------------------------------------------------------------
  app.get('/api/v1/email-forensics/database-status', async (request) => {
    await authenticate(request, env, pool);
    const versions = await listDatabaseVersions(pool);
    return {
      versions: versions.map((v) => ({
        provider: v.databaseProvider,
        name: v.databaseName,
        version: v.version,
        lastUpdatedAt: v.lastUpdatedAt?.toISOString() ?? null,
        status: v.status,
      })),
      note: 'IP intelligence is provided from a locally stored database — no third-party lookup API is used.',
    };
  });
}

/** Minimal self-contained PDF generator (plain ASCII, no external library). Produces a valid
 *  PDF v1.4 document containing the report as wrapped text. */
function buildPdfReport(report: Record<string, unknown>): Buffer {
  const lines: string[] = [];
  lines.push('CloudHost247 — Email Trace & Forensics Analyzer');
  lines.push('Analysis reference: ' + String((report as any).analysisReference ?? ''));
  lines.push('Generated at: ' + String((report as any).generatedAt ?? ''));
  lines.push('');
  lines.push('--- Email Overview ---');
  const ov = (report as any).emailOverview ?? {};
  lines.push('Sender: ' + String(ov.sender ?? ''));
  lines.push('Recipient: ' + String(ov.recipient ?? ''));
  lines.push('Subject: ' + String(ov.subject ?? ''));
  lines.push('Message-ID: ' + String(ov.messageId ?? ''));
  lines.push('Sending domain: ' + String(ov.sendingDomain ?? ''));
  lines.push('');
  lines.push('--- Source IP Candidates ---');
  for (const c of (report as any).sourceIpCandidates ?? []) {
    lines.push(`- ${c.ipAddress} (${c.ipVersion}) ${c.addressClass} / ${c.trustClassification} / ${c.confidenceLevel} confidence — ${c.sourceHeader}`);
  }
  lines.push('');
  lines.push('--- Route Hops ---');
  for (const h of (report as any).routeHops ?? []) {
    lines.push(`- Hop ${h.hopNumber}: ${h.hostname ?? 'unknown'} ${h.ipAddress ?? ''} ${h.receivedTimestamp ?? ''}`);
  }
  lines.push('');
  lines.push('--- Authentication ---');
  for (const a of (report as any).authentication ?? []) {
    lines.push(`- ${a.authenticationType}: ${a.reportedResult ?? 'none'} ${a.independentlyVerified ? '(verified)' : '(reported only)'}`);
  }
  lines.push('');
  lines.push('--- Limitations ---');
  for (const l of (report as any).limitations ?? []) {
    lines.push('- ' + l);
  }
  lines.push('');
  lines.push('This is not a legally certified forensic report.');

  const content = lines.join('\n');
  const escaped = content.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\n/g, '\\n');
  const stream = `BT /F1 12 Tf 50 800 Td (${escaped}) Tj ET`;
  const streamBytes = Buffer.from(stream, 'utf8');

  const xref: number[] = [];
  let offset = 0;
  const header = '%PDF-1.4\n';
  offset += header.length;

  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  xref.push(offset); offset += obj1.length;
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  xref.push(offset); offset += obj2.length;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  xref.push(offset); offset += obj3.length;
  const obj4 = `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  xref.push(offset); offset += obj4.length;
  const obj5 = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  xref.push(offset); offset += obj5.length;

  const xrefOffset = offset;
  let xrefText = `xref\n0 ${xref.length + 1}\n0000000000 65535 f \n`;
  for (const o of xref) {
    xrefText += `${String(o).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${xref.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const parts = [header, obj1, obj2, obj3, obj4, obj5, xrefText, trailer];
  return Buffer.concat(parts.map((p) => Buffer.from(p, 'latin1')));
}
