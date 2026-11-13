import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { registerFileToolsApiRoutes } from './file-tools-api';

/** Public, non-sensitive catalogue for the browser-local File Tools workspace. */
export const FILE_TOOLS_CAPABILITIES = Object.freeze({
  version: '2.0',
  processing: 'browser-local with optional ephemeral REST API jobs',
  browserToolsUploadFileContents: false,
  apiJobsAcceptFileContents: true,
  apiJobStorage: 'in-memory only; 15-minute expiry; no permanent file storage',
  remoteStorageIntegrations: false,
  supported: {
    convert: {
      imageInputs: ['PNG', 'JPEG/JFIF', 'WebP', 'GIF', 'BMP', 'AVIF', 'HEIC/HEIF', 'SVG'],
      imageOutputs: ['PNG', 'JPEG', 'WebP', 'SVG raster wrapper', 'PDF'],
      imageApiInputs: ['Formats supported by the deployed libvips build (including JPEG, PNG, WebP, AVIF and GIF)'],
      imageApiOutputs: ['JPEG', 'PNG', 'WebP', 'AVIF', 'TIFF'],
      svgOutputNote: 'SVG output wraps an embedded PNG raster; it is not vector tracing.',
      heicNote: 'HEIC/HEIF decoding depends on browser support or the bundled browser decoder; metadata is not preserved.',
      animatedImageTools: ['images-to-GIF', 'video-clip-to-GIF', 'GIF/APNG-to-GIF', 'GIF-compression', 'GIF/APNG-to-APNG', 'GIF/APNG-to-MP4'],
      animatedImageLimits: { maxFrames: 120, maxDimension: 480, maxAnimationSeconds: 30, maxVideoGifSeconds: 10 },
      animationApi: ['GIF compression only; frame limit 120; output is server-side and transient'],
      imageResizer: { maxDimension: 8192, maxPixels: 32000000, allowsUpscaling: true },

      pdfInputs: ['PDF'],
      pdfPageOutputs: ['PNG', 'JPEG', 'WebP'],
      pdfPageSelection: true,
      imageCropRotateFlip: true,
      combineImagesIntoPdf: true,
      audioInputs: ['AAC/ADTS', 'FLAC', 'M4A', 'MP3', 'OGG/Opus', 'WAV', 'audio tracks in MKV, MOV, MP4, MPEG-TS, and WebM'],
      audioOutputs: ['MP3', 'WAV/PCM', 'FLAC', 'OGG/Opus'],
      videoInputs: ['M4V', 'MKV', 'MOV/QuickTime', 'MP4', 'MPEG-TS', 'WebM'],
      videoOutputs: ['MP4/H.264', 'WebM/VP9'],
      mediaProcessing: 'WebCodecs/browser codec support required; primary audio/video tracks are converted.',
      textDocumentInputs: ['TXT', 'Markdown', 'CSV', 'JSON', 'HTML', 'DOCX', 'ODT', 'EPUB', 'PDF'],
      textDocumentOutputs: ['PDF', 'TXT'],
      documentConversionNote: 'Office, EPUB, HTML, and PDF text extraction is text-only; layout and images are not preserved. PDF extraction is not OCR.',
    },
    compress: {
      images: ['JPEG', 'PNG', 'WebP', 'GIF', 'BMP', 'AVIF'],
      gif: ['Animated GIF re-encoding, palette reduction, and dimension limit'],
      pdf: true,
      audio: ['MP3 bitrate control', 'OGG/Opus bitrate control'],
      video: ['MP4/H.264 quality control', 'WebM/VP9 quality control'],
      pdfCompressionMethod: 'rasterize-to-jpeg',
      pdfCompressionWarning: 'PDF text, links, form fields, and existing signatures are flattened.',
      apiPdfCompressionMethod: 'Node PDF.js rasterizer and JPEG re-encoding',
      apiMaxInputBytes: 16 * 1024 * 1024,
      apiMaxOutputBytes: 64 * 1024 * 1024,
    },
  imageTools: ['resize', 'crop', 'rotate', 'flip', 'pixel-color-picker'],
  pdfTools: ['merge', 'extract-pages', 'remove-pages', 'rotate-pages', 'reorder-pages', 'crop-pages', 'resize-pages', 'flatten-forms', 'password-protect-AES-256', 'unlock-with-password', 'extract-text'],
  documentTools: ['text-to-pdf', 'html-to-text', 'docx-to-text', 'odt-to-text', 'epub-to-text'],
  archive: ['create-zip', 'extract-zip', 'gzip', 'gunzip', 'safe-path-validation'],
  animationTools: ['images-to-gif', 'video-to-gif', 'gif-to-apng', 'gif-to-mp4', 'gif-compression'],

    units: ['length', 'mass', 'temperature', 'digital-storage', 'duration', 'volume'],
    timeTools: ['local-datetime-to-unix', 'unix-to-local-datetime', 'unix-to-ISO-8601'],
  },
  limits: {
    filesPerBatch: 20,
    maxFileBytes: 25 * 1024 * 1024,
    maxPdfPagesPerFile: 25,
    maxOutputDimension: 8192,
    maxOutputPixels: 32_000_000,
    maxZipBytes: 250 * 1024 * 1024,
    maxZipEntries: 100,
    maxArchiveExpandedBytes: 250 * 1024 * 1024,
    maxMediaDurationSeconds: 600,
    maxMediaOutputBytes: 250 * 1024 * 1024,
  },
  pricing: {
    browserTools: 'free',
    apiProcessing: 'free with published request and size limits; no paid plans are configured',
    paidPlans: [],
  },
  api: {
    capabilities: ['/api/file-tools/capabilities', '/api/v1/file-tools/capabilities'],
    jobs: ['/api/v1/file-tools/jobs', '/api/v1/file-tools/jobs/{jobId}'],
    documentation: ['/api/v1/file-tools/docs', '/api/v1/file-tools/openapi.json'],
    specificApis: ['/api/v1/file-tools/convert/*', '/api/v1/file-tools/compress/*', '/api/v1/file-tools/resize/*', '/api/v1/file-tools/crop/*', '/api/v1/file-tools/rotate/*', '/api/v1/file-tools/extract/*', '/api/v1/file-tools/decompress/*'],
    acceptsFileContents: true,
    uploadFormat: 'JSON with standard Base64 file bytes; files are processed in memory, not written to permanent storage',
    limits: { maxFileBytes: 8 * 1024 * 1024, maxTotalInputBytes: 16 * 1024 * 1024, maxOutputBytes: 64 * 1024 * 1024, maxFilesPerJob: 20, requestsPerMinutePerIp: 20, maxConcurrentJobs: 3, maxQueuedJobs: 12, jobExpiryMinutes: 15 },
    mediaRestApi: false,
    description: 'The REST API offers asynchronous image, GIF, PDF, document and archive jobs. Audio/video transcoding remains browser-local because server-side codec support and deployment licensing are not guaranteed.',
  },
});

export async function registerFileToolsRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { success: true, ...FILE_TOOLS_CAPABILITIES };
  };
  app.get('/api/file-tools/capabilities', handler);
  app.get('/api/v1/file-tools/capabilities', handler);
  registerFileToolsApiRoutes(app);
}
