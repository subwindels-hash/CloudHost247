import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../lib/errors';
import {
  API_MAX_BATCH_FILES,
  API_MAX_FILE_BYTES,
  API_MAX_TOTAL_INPUT_BYTES,
  FileProcessingError,
  processFileApiJob,
  type ApiJobRequest,
  type FileApiOperation,
} from '../file-tools/api-processing';

const API_MAX_REQUEST_BODY_BYTES = 24 * 1024 * 1024;
const JOB_TTL_MS = 15 * 60 * 1000;
const MAX_RETAINED_JOBS = 200;
const MAX_ACTIVE_JOBS = 3;
const MAX_QUEUED_JOBS = 12;
const MAX_REQUESTS_PER_MINUTE = 20;
const API_OPERATIONS = [
  'image.convert', 'image.compress', 'image.resize', 'image.crop', 'image.rotate', 'gif.compress',
  'pdf.merge', 'pdf.extract', 'pdf.remove', 'pdf.rotate', 'pdf.reorder', 'pdf.crop', 'pdf.resize', 'pdf.flatten', 'pdf.compress',
  'document.to-pdf', 'document.extract-text',
  'archive.create-zip', 'archive.extract-zip', 'archive.gzip', 'archive.gunzip',
] as const satisfies readonly FileApiOperation[];

const inputFileSchema = z.object({
  fileName: z.string().min(1).max(255),
  dataBase64: z.string().min(1).max(Math.ceil(API_MAX_FILE_BYTES / 3) * 4 + 16),
  contentType: z.string().max(120).optional(),
}).strict();
const specificJobSchema = z.object({
  files: z.array(inputFileSchema).min(1).max(API_MAX_BATCH_FILES),
  options: z.record(z.string(), z.unknown()).optional().default({}),
}).strict();
const genericJobSchema = specificJobSchema.extend({ operation: z.enum(API_OPERATIONS) }).strict();

type ApiJobState = 'queued' | 'processing' | 'completed' | 'failed';
type ApiJob = {
  id: string;
  operation: FileApiOperation;
  status: ApiJobState;
  createdAt: string;
  expiresAt: string;
  output: { fileName: string; contentType: string; data: Uint8Array } | null;
  error: string | null;
};

const jobs = new Map<string, ApiJob>();
const requestTimes = new Map<string, number[]>();
let activeJobs = 0;
let queuedJobs = 0;

const SPECIFIC_PATHS: ReadonlyArray<{ path: string; operation: FileApiOperation }> = [
  { path: '/api/v1/file-tools/convert/image', operation: 'image.convert' },
  { path: '/api/v1/file-tools/compress/image', operation: 'image.compress' },
  { path: '/api/v1/file-tools/resize/image', operation: 'image.resize' },
  { path: '/api/v1/file-tools/crop/image', operation: 'image.crop' },
  { path: '/api/v1/file-tools/rotate/image', operation: 'image.rotate' },
  { path: '/api/v1/file-tools/compress/gif', operation: 'gif.compress' },
  { path: '/api/v1/file-tools/convert/pdf/merge', operation: 'pdf.merge' },
  { path: '/api/v1/file-tools/convert/pdf/extract', operation: 'pdf.extract' },
  { path: '/api/v1/file-tools/convert/pdf/remove-pages', operation: 'pdf.remove' },
  { path: '/api/v1/file-tools/convert/pdf/rotate', operation: 'pdf.rotate' },
  { path: '/api/v1/file-tools/convert/pdf/reorder', operation: 'pdf.reorder' },
  { path: '/api/v1/file-tools/convert/pdf/crop', operation: 'pdf.crop' },
  { path: '/api/v1/file-tools/convert/pdf/resize', operation: 'pdf.resize' },
  { path: '/api/v1/file-tools/convert/pdf/flatten', operation: 'pdf.flatten' },
  { path: '/api/v1/file-tools/compress/pdf', operation: 'pdf.compress' },
  { path: '/api/v1/file-tools/convert/document/pdf', operation: 'document.to-pdf' },
  { path: '/api/v1/file-tools/convert/document/text', operation: 'document.extract-text' },
  { path: '/api/v1/file-tools/convert/archive/zip', operation: 'archive.create-zip' },
  { path: '/api/v1/file-tools/extract/archive/zip', operation: 'archive.extract-zip' },
  { path: '/api/v1/file-tools/compress/archive/gzip', operation: 'archive.gzip' },
  { path: '/api/v1/file-tools/decompress/archive/gzip', operation: 'archive.gunzip' },
];

function expireOldJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (Date.parse(job.expiresAt) <= now) jobs.delete(id);
  }
  while (jobs.size >= MAX_RETAINED_JOBS) {
    const oldest = [...jobs.values()].find((job) => job.status === 'completed' || job.status === 'failed');
    if (!oldest) break;
    jobs.delete(oldest.id);
  }
  for (const [ip, times] of requestTimes) {
    const recent = times.filter((time) => now - time < 60_000);
    if (recent.length) requestTimes.set(ip, recent);
    else requestTimes.delete(ip);
  }
}

function acceptRequest(request: FastifyRequest, reply: FastifyReply): boolean {
  expireOldJobs();
  const ip = request.ip || 'unknown';
  const now = Date.now();
  const recent = (requestTimes.get(ip) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) {
    reply.header('Retry-After', '60').code(429).send({ success: false, error: 'RATE_LIMITED', message: `File API is limited to ${MAX_REQUESTS_PER_MINUTE} job submissions per minute per IP address.` });
    return false;
  }
  if (activeJobs >= MAX_ACTIVE_JOBS && queuedJobs >= MAX_QUEUED_JOBS) {
    reply.header('Retry-After', '10').code(503).send({ success: false, error: 'API_BUSY', message: 'The File Tools API queue is full. Try again shortly.' });
    return false;
  }
  requestTimes.set(ip, [...recent, now]);
  return true;
}

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
}

function buildJobResponse(job: ApiJob) {
  return {
    success: job.status !== 'failed',
    jobId: job.id,
    operation: job.operation,
    status: job.status,
    statusUrl: `/api/v1/file-tools/jobs/${job.id}`,
    downloadUrl: job.status === 'completed' ? `/api/v1/file-tools/jobs/${job.id}/download` : null,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    output: job.output ? { fileName: job.output.fileName, contentType: job.output.contentType, sizeBytes: job.output.data.byteLength } : null,
    error: job.error,
  };
}

async function enqueueJob(request: FastifyRequest, reply: FastifyReply, forcedOperation?: FileApiOperation): Promise<unknown> {
  if (!acceptRequest(request, reply)) return reply;
  const parsed = forcedOperation ? specificJobSchema.safeParse(request.body) : genericJobSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid File Tools API job request.');
  const body = parsed.data;
  const jobRequest: ApiJobRequest = {
    operation: forcedOperation ?? (body as z.infer<typeof genericJobSchema>).operation,
    files: body.files,
    options: body.options,
  };
  const encodedBytes = jobRequest.files.reduce((total, file) => total + Math.ceil(file.dataBase64.length * 3 / 4), 0);
  if (encodedBytes > API_MAX_TOTAL_INPUT_BYTES + jobRequest.files.length * 2) {
    throw new ValidationError(`Combined input is limited to ${API_MAX_TOTAL_INPUT_BYTES / 1024 / 1024} MiB per job.`);
  }
  if (activeJobs + queuedJobs >= MAX_ACTIVE_JOBS + MAX_QUEUED_JOBS) {
    reply.header('Retry-After', '10').code(503);
    return { success: false, error: 'API_BUSY', message: 'The File Tools API queue is full. Try again shortly.' };
  }
  const now = Date.now();
  const job: ApiJob = {
    id: randomUUID(),
    operation: jobRequest.operation,
    status: 'queued',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + JOB_TTL_MS).toISOString(),
    output: null,
    error: null,
  };
  jobs.set(job.id, job);
  queuedJobs += 1;
  setImmediate(() => {
    queuedJobs = Math.max(0, queuedJobs - 1);
    activeJobs += 1;
    job.status = 'processing';
    void processFileApiJob(jobRequest).then((output) => {
      job.output = output;
      job.status = 'completed';
    }).catch((error: unknown) => {
      job.status = 'failed';
      job.error = error instanceof FileProcessingError || error instanceof Error ? error.message : 'The file operation failed.';
    }).finally(() => {
      activeJobs = Math.max(0, activeJobs - 1);
    });
  });
  noStore(reply);
  reply.code(202).header('Location', `/api/v1/file-tools/jobs/${job.id}`);
  return buildJobResponse(job);
}

const OPENAPI_DOCUMENT = {
  openapi: '3.1.0',
  info: {
    title: 'CloudHost247 File Tools API',
    version: '1.0.0',
    description: 'Asynchronous, ephemeral file conversion and compression jobs. Files are held in process memory only and are removed with the job after 15 minutes. Browser-local media operations remain available through the web UI but are not server-side REST operations.',
  },
  servers: [{ url: '/api/v1/file-tools', description: 'CloudHost247 API' }],
  paths: {
    '/jobs': {
      post: {
        summary: 'Create a conversion, editing, archive, or compression job',
        description: 'Send JSON with an operation, Base64 file objects and optional operation-specific settings. Limits: 8 MiB per file, 16 MiB decoded input per job, 64 MiB output, 20 files per job. Base64 expands request size.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/JobRequest' } } } },
        responses: { '202': { description: 'Queued job and poll/download links.' }, '400': { description: 'Invalid options or file payload.' }, '429': { description: 'Rate limit reached.' } },
      },
    },
    '/jobs/{jobId}': { get: { summary: 'Get job status and output metadata', parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Job status.' }, '404': { description: 'Unknown or expired job.' } } } },
    '/jobs/{jobId}/download': { get: { summary: 'Download the completed output file', parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'The converted file.' }, '409': { description: 'Job is not complete.' } } } },
    '/convert/image': { post: { summary: 'Convert one image' } },
    '/compress/image': { post: { summary: 'Compress one image' } },
    '/compress/pdf': { post: { summary: 'Compress one PDF (rasterizes and flattens pages)' } },
    '/compress/gif': { post: { summary: 'Compress one animated GIF' } },
    '/convert/pdf/merge': { post: { summary: 'Merge PDFs in supplied order' } },
    '/convert/document/pdf': { post: { summary: 'Convert text or HTML into a simple PDF' } },
    '/convert/document/text': { post: { summary: 'Extract text from a supported document' } },
    '/convert/archive/zip': { post: { summary: 'Create a ZIP archive' } },
    '/extract/archive/zip': { post: { summary: 'Safely extract a ZIP into a new ZIP archive' } },
    '/compress/archive/gzip': { post: { summary: 'Compress a file as GZIP' } },
    '/decompress/archive/gzip': { post: { summary: 'Decompress a GZIP file' } },
  },
  components: {
    schemas: {
      JobRequest: {
        type: 'object', required: ['operation', 'files'], additionalProperties: false,
        properties: {
          operation: { type: 'string', enum: API_OPERATIONS },
          files: { type: 'array', minItems: 1, maxItems: API_MAX_BATCH_FILES, items: { type: 'object', required: ['fileName', 'dataBase64'], properties: { fileName: { type: 'string' }, contentType: { type: 'string' }, dataBase64: { type: 'string', description: 'Standard Base64-encoded file bytes.' } } } },
          options: { type: 'object', additionalProperties: true, description: 'Operation-specific settings such as format, quality, pages, rotation, dimensions, crop bounds, DPI or GZIP level.' },
        },
      },
    },
  },
};

const API_MARKDOWN = `# CloudHost247 File Tools API\n\nThe REST API exposes asynchronous conversion jobs for image and PDF operations, supported document/ebook text extraction, ZIP/GZIP operations, and compression.\n\n## Create a job\n\n\`POST /api/v1/file-tools/jobs\` with JSON:\n\n\`\`\`json\n{\n  "operation": "image.compress",\n  "files": [{ "fileName": "photo.png", "contentType": "image/png", "dataBase64": "<standard-base64>" }],\n  "options": { "format": "webp", "quality": 76, "width": 2048, "height": 2048 }\n}\n\`\`\`\n\nThe response is \`202 Accepted\` with a \`jobId\`, \`statusUrl\`, and (when complete) \`downloadUrl\`. Poll the status URL, then GET the download URL. Use the specific endpoint (for example \`POST /api/v1/file-tools/compress/image\`) with \`files\` and \`options\` to select an operation without including the \`operation\` property.\n\n## Supported operations\n\n- Image: \`image.convert\`, \`image.compress\`, \`image.resize\`, \`image.crop\`, \`image.rotate\`; input formats accepted by the installed libvips build, output JPEG, PNG, WebP, AVIF or TIFF.\n- Animation: \`gif.compress\` for animated GIFs up to 120 frames.\n- PDF: merge, extract, remove, rotate, reorder, crop, resize, flatten forms, and rasterize/compress. PDF compression turns pages into JPEG images; text, links, forms and signatures are flattened.\n- Documents: text/HTML to PDF and text extraction from PDF, TXT, Markdown, CSV, JSON, HTML, DOCX, ODT, EPUB. Layout, images and OCR are not preserved.\n- Archives: create/extract ZIP and GZIP/gunzip. ZIP extraction validates paths and bounds expanded size; extracted entries are returned inside a ZIP file.\n\n## Limits and privacy\n\nA job accepts up to 20 files, 8 MiB per file, 16 MiB combined decoded input, and 64 MiB output. Jobs are in-memory and expire after 15 minutes; no file is written to permanent storage. The API is rate-limited to 20 job submissions per minute per IP, with at most 3 processing jobs and 12 queued. Do not send sensitive files unless your deployment's privacy policy permits it. API uploads leave the browser and are distinct from browser-local tools. Media transcoding (audio/video), video GIF extraction, and APNG creation remain browser-local and are not exposed as REST APIs.\n\nOpenAPI JSON: \`GET /api/v1/file-tools/openapi.json\`.\n`;

export function registerFileToolsApiRoutes(app: FastifyInstance): void {
  app.post('/api/v1/file-tools/jobs', { bodyLimit: API_MAX_REQUEST_BODY_BYTES }, async (request, reply) => enqueueJob(request, reply));
  for (const { path, operation } of SPECIFIC_PATHS) {
    app.post(path, { bodyLimit: API_MAX_REQUEST_BODY_BYTES }, async (request, reply) => enqueueJob(request, reply, operation));
  }
  app.get('/api/v1/file-tools/jobs/:jobId', async (request, reply) => {
    expireOldJobs();
    const { jobId } = request.params as { jobId: string };
    const job = jobs.get(jobId);
    if (!job) throw new NotFoundError('File API job not found or expired.');
    noStore(reply);
    return buildJobResponse(job);
  });
  app.get('/api/v1/file-tools/jobs/:jobId/download', async (request, reply) => {
    expireOldJobs();
    const { jobId } = request.params as { jobId: string };
    const job = jobs.get(jobId);
    if (!job) throw new NotFoundError('File API job not found or expired.');
    noStore(reply);
    if (job.status === 'failed') return reply.code(422).send({ success: false, error: job.error ?? 'The file operation failed.' });
    if (job.status !== 'completed' || !job.output) return reply.header('Retry-After', '1').code(409).send({ success: false, error: 'JOB_NOT_COMPLETE', status: job.status });
    const safeName = job.output.fileName.replace(/["\\\r\n]/g, '_');
    reply.header('Content-Type', job.output.contentType);
    reply.header('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(job.output.fileName)}`);
    reply.header('Content-Length', String(job.output.data.byteLength));
    return reply.send(Buffer.from(job.output.data));
  });
  app.get('/api/v1/file-tools/openapi.json', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return OPENAPI_DOCUMENT;
  });
  app.get('/api/v1/file-tools/docs', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    reply.type('text/markdown; charset=utf-8');
    return API_MARKDOWN;
  });
}
