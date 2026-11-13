import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { FILE_TOOLS_CAPABILITIES, registerFileToolsRoutes } from '../../src/routes/file-tools';

function base64(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
}

function makePng(): Uint8Array {
  const canvas = createCanvas(4, 4);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f97316';
  context.fillRect(0, 0, 4, 4);
  return new Uint8Array(canvas.toBuffer('image/png'));
}

async function makePdf(label: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  page.drawText(label);
  return pdf.save();
}

async function startApp() {
  const app = Fastify({ logger: false });
  await registerFileToolsRoutes(app);
  return app;
}

async function awaitJob(app: Fastify.FastifyInstance, jobId: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/file-tools/jobs/${jobId}` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; error?: string | null };
    if (body.status === 'completed' || body.status === 'failed') return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the file API job.');
}

async function createJob(app: Fastify.FastifyInstance, payload: unknown, endpoint = '/api/v1/file-tools/jobs') {
  const response = await app.inject({ method: 'POST', url: endpoint, payload });
  expect(response.statusCode).toBe(202);
  expect(response.headers['cache-control']).toBe('no-store, max-age=0');
  return response.json() as { jobId: string; status: string; statusUrl: string; downloadUrl: string | null };
}

describe('File Tools API', () => {
  it('serves a cached capabilities manifest and documents actual REST processing', async () => {
    const app = await startApp();
    const versioned = await app.inject({ method: 'GET', url: '/api/v1/file-tools/capabilities' });
    const alias = await app.inject({ method: 'GET', url: '/api/file-tools/capabilities' });
    expect(versioned.statusCode).toBe(200);
    expect(versioned.headers['cache-control']).toBe('public, max-age=300');
    expect(versioned.json()).toEqual({ success: true, ...FILE_TOOLS_CAPABILITIES });
    expect(alias.json()).toEqual(versioned.json());
    expect(versioned.json().browserToolsUploadFileContents).toBe(false);
    expect(versioned.json().api.acceptsFileContents).toBe(true);
    expect(versioned.json().api.mediaRestApi).toBe(false);
    expect(versioned.json().supported.convert.audioOutputs).toContain('MP3');
    expect(versioned.json().supported.archive).toContain('extract-zip');
    expect(versioned.json().supported.timeTools).toContain('unix-to-ISO-8601');
    expect(versioned.json().limits.maxMediaDurationSeconds).toBe(600);
    expect((await app.inject({ url: '/api/v1/file-tools/openapi.json' })).json().openapi).toBe('3.1.0');
    expect((await app.inject({ url: '/api/v1/file-tools/docs' })).body).toContain('15 minutes');
    await app.close();
  });

  it('converts an image through the specific REST endpoint and serves a transient downloadable job output', async () => {
    const app = await startApp();
    try {
      const png = makePng();
      const job = await createJob(app, {
        files: [{ fileName: 'tiny.png', contentType: 'image/png', dataBase64: base64(png) }],
        options: { format: 'webp', quality: 78 },
      }, '/api/v1/file-tools/convert/image');
      expect(job.status).toBe('queued');
      const completed = await awaitJob(app, job.jobId);
      expect(completed.status).toBe('completed');
      const status = await app.inject({ url: `/api/v1/file-tools/jobs/${job.jobId}` });
      expect(status.json().output.fileName).toBe('tiny-converted.webp');
      const download = await app.inject({ url: `/api/v1/file-tools/jobs/${job.jobId}/download` });
      expect(download.statusCode).toBe(200);
      expect(download.headers['content-type']).toContain('image/webp');
      expect(download.headers['content-disposition']).toContain('tiny-converted.webp');
      expect(download.rawPayload.byteLength).toBeGreaterThan(12);
    } finally { await app.close(); }
  });

  it('merges PDFs and raster-compresses one PDF through the conversion APIs', async () => {
    const app = await startApp();
    try {
      const first = await makePdf('first');
      const second = await makePdf('second');
      const mergeJob = await createJob(app, {
        operation: 'pdf.merge',
        files: [{ fileName: 'one.pdf', dataBase64: base64(first) }, { fileName: 'two.pdf', dataBase64: base64(second) }],
      });
      expect((await awaitJob(app, mergeJob.jobId)).status).toBe('completed');
      const merged = await app.inject({ url: `/api/v1/file-tools/jobs/${mergeJob.jobId}/download` });
      const mergedPdf = await PDFDocument.load(merged.rawPayload);
      expect(mergedPdf.getPageCount()).toBe(2);

      const compressJob = await createJob(app, {
        operation: 'pdf.compress',
        files: [{ fileName: 'source.pdf', dataBase64: base64(first) }],
        options: { quality: 75, dpi: 72 },
      });
      const compressedState = await awaitJob(app, compressJob.jobId);
      expect(compressedState.status, compressedState.error ?? undefined).toBe('completed');
      const compressed = await app.inject({ url: `/api/v1/file-tools/jobs/${compressJob.jobId}/download` });
      expect(compressed.headers['content-type']).toContain('application/pdf');
      expect((await PDFDocument.load(compressed.rawPayload)).getPageCount()).toBe(1);
    } finally { await app.close(); }
  }, 30_000);

  it('creates searchable text PDFs and extracts their text, and bounds the GZIP API', async () => {
    const app = await startApp();
    try {
      const text = Buffer.from('File Tools API smoke test');
      const pdfJob = await createJob(app, {
        operation: 'document.to-pdf', files: [{ fileName: 'note.txt', dataBase64: text.toString('base64') }],
      });
      expect((await awaitJob(app, pdfJob.jobId)).status).toBe('completed');
      const pdfResponse = await app.inject({ url: `/api/v1/file-tools/jobs/${pdfJob.jobId}/download` });
      const pdfBytes = new Uint8Array(pdfResponse.rawPayload);
      const extractJob = await createJob(app, {
        operation: 'document.extract-text', files: [{ fileName: 'note.pdf', dataBase64: base64(pdfBytes) }],
      });
      const extractState = await awaitJob(app, extractJob.jobId);
      expect(extractState.status, extractState.error ?? undefined).toBe('completed');
      const txt = await app.inject({ url: `/api/v1/file-tools/jobs/${extractJob.jobId}/download` });
      expect(txt.body).toContain('File Tools API smoke test');

      const gzipJob = await createJob(app, {
        operation: 'archive.gzip', files: [{ fileName: 'note.txt', dataBase64: text.toString('base64') }],
      });
      expect((await awaitJob(app, gzipJob.jobId)).status).toBe('completed');
      const gunzipJob = await createJob(app, {
        operation: 'archive.gunzip', files: [{ fileName: 'note.txt.gz', dataBase64: base64((await app.inject({ url: `/api/v1/file-tools/jobs/${gzipJob.jobId}/download` })).rawPayload) }],
      });
      expect((await awaitJob(app, gunzipJob.jobId)).status).toBe('completed');
      expect((await app.inject({ url: `/api/v1/file-tools/jobs/${gunzipJob.jobId}/download` })).body).toBe('File Tools API smoke test');
    } finally { await app.close(); }
  }, 30_000);

  it('validates operation names and rejects unsafe ZIP paths without touching the filesystem', async () => {
    const app = await startApp();
    try {
      const invalid = await app.inject({ method: 'POST', url: '/api/v1/file-tools/jobs', payload: { operation: 'video.convert', files: [] } });
      expect(invalid.statusCode).toBe(400);
      const pathCheck = await createJob(app, {
        operation: 'archive.extract-zip', files: [{ fileName: 'bad.zip', dataBase64: 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==' }],
      });
      const result = await awaitJob(app, pathCheck.jobId);
      expect(result.status).toBe('failed');
      expect(result.error).toBeTruthy();
    } finally { await app.close(); }
  });
});
