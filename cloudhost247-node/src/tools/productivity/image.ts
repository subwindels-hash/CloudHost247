/**
 * Tools Center — image tools (spec §59 reverse image search, §60 image OCR).
 *
 * Both tools require an operator-configured provider. There is no local OCR engine and no local
 * image-similarity index on this platform, and inventing either would produce exactly the kind of
 * fabricated result §95 forbids. When the provider is missing the tools fail closed with
 * CONFIGURATION_REQUIRED and tell the Super Admin what to configure.
 *
 * Images are accepted as Base64 data (see the routes' body limit). They are forwarded to the
 * provider and are never written to disk, a log, or the history summary.
 */
import { randomBytes } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { invalidInput, ToolError } from '../core/errors';
import { fetchWithGuard } from '../core/ssrf';
import { providerSecret, recordProviderOutcome, requireProvider, usableProviders } from '../core/providers';
import { sanitizeUntrustedText } from '../core/validation';
import { resolvePublicAddresses } from '../core/ssrf';

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** A usable provider always has an endpoint (the registry's `usable` rule), but be explicit. */
function requireEndpoint(endpoint: string | null, providerName: string): string {
  if (!endpoint) throw new ToolError('CONFIGURATION_REQUIRED', `The provider "${providerName}" has no endpoint configured.`);
  return endpoint;
}

export interface ImagePayload {
  /** `data:image/png;base64,…` or bare Base64. */
  data?: string;
  /** A public HTTPS image URL, used instead of an upload. */
  url?: string;
  mimeType?: string;
}

function decodeImage(payload: ImagePayload): { buffer: Buffer; mimeType: string } {
  const raw = payload.data ?? '';
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(raw.trim());
  const mimeType = match?.[1] ?? payload.mimeType ?? 'image/png';
  const base64 = match?.[2] ?? raw;
  if (base64.length === 0) throw invalidInput('Upload an image or provide an image URL.');
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    throw invalidInput(`The image exceeds the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB limit. Resize it before uploading.`);
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw invalidInput('The image data is not valid Base64.');
  }
  if (buffer.length === 0) throw invalidInput('The image is empty.');
  if (buffer.length > MAX_IMAGE_BYTES) throw invalidInput(`The image exceeds the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB limit.`);
  if (!/^image\/(png|jpeg|jpg|webp|gif|bmp|tiff)$/i.test(mimeType)) {
    throw invalidInput(`"${mimeType}" is not a supported image type. Use PNG, JPEG, WebP, GIF, BMP or TIFF.`);
  }
  return { buffer, mimeType: mimeType.toLowerCase() };
}

async function validateImageUrl(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) throw invalidInput('An image URL must use HTTPS so it can be fetched by the provider safely.');
  const parsed = new URL(trimmed);
  // The provider does the fetching, but we do not hand it a URL that our own SSRF rules would
  // refuse: that would make CloudHost247 the source of an internal-network probe.
  await resolvePublicAddresses(parsed.hostname);
  return parsed.toString();
}

/** Builds a multipart/form-data body without a dependency — fetchWithGuard takes a Buffer. */
export function multipartBody(parts: Array<{ name: string; value: string } | { name: string; filename: string; contentType: string; data: Buffer }>, boundary: string): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
    if ('data' in part) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`, 'utf8'));
      chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n\r\n`, 'utf8'));
      chunks.push(part.data);
      chunks.push(Buffer.from('\r\n', 'utf8'));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`, 'utf8'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
}

function readPath(source: unknown, path: string | undefined): unknown {
  if (!path) return source;
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ---------------------------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------------------------

export interface OcrResult {
  text: string;
  confidence: number | null;
  language: string | null;
  blocks: Array<{ text: string; confidence: number | null }>;
  provider: { name: string; slug: string; kind: 'OCR' };
  durationMs: number;
  notes: string[];
}

export async function imageOcr(db: Queryable, input: { image: ImagePayload; language?: string }): Promise<OcrResult> {
  const provider = await requireProvider(db, 'OCR', 'Image OCR');
  const secret = await providerSecret(db, provider.slug);
  const fieldName = typeof provider.configuration.fieldName === 'string' ? provider.configuration.fieldName : 'image';
  const mode = provider.configuration.mode === 'base64-json' ? 'base64-json' : 'multipart';
  const apiKeyHeader = typeof provider.configuration.apiKeyHeader === 'string' ? provider.configuration.apiKeyHeader : null;
  const language = input.language ?? (typeof provider.configuration.language === 'string' ? provider.configuration.language : undefined);

  const startedAt = Date.now();
  let responseText: string;
  try {
    if (mode === 'base64-json') {
      const { buffer, mimeType } = decodeImage(input.image);
      const response = await fetchWithGuard(requireEndpoint(provider.endpoint, provider.name), {
        method: 'POST',
        timeoutMs: Math.max(provider.timeoutMs, 10_000),
        maxBytes: 512 * 1024,
        headers: {
          'content-type': 'application/json',
          ...(secret.apiKey && apiKeyHeader ? { [apiKeyHeader]: secret.apiKey } : {}),
          ...(secret.apiKey && !apiKeyHeader ? { authorization: `Bearer ${secret.apiKey}` } : {}),
        },
        body: JSON.stringify({ [fieldName]: buffer.toString('base64'), mimeType, language }),
      });
      responseText = response.bodyText;
      if (response.status !== 200) throw new ToolError('PROVIDER_ERROR', `The OCR provider answered HTTP ${response.status}.`);
    } else {
      const imageUrl = input.image.url ? await validateImageUrl(input.image.url) : null;
      const decoded = imageUrl ? null : decodeImage(input.image);
      if (!imageUrl && !decoded) throw invalidInput('Multipart OCR providers need either an image upload or a public HTTPS image URL.');
      const boundary = `ch247${randomBytes(12).toString('hex')}`;
      const parts: Array<{ name: string; value: string } | { name: string; filename: string; contentType: string; data: Buffer }> = [];
      if (decoded) parts.push({ name: fieldName, filename: 'upload', contentType: decoded.mimeType, data: decoded.buffer });
      else parts.push({ name: fieldName, value: imageUrl! });
      if (language) parts.push({ name: 'language', value: language });
      const response = await fetchWithGuard(requireEndpoint(provider.endpoint, provider.name), {
        method: 'POST',
        timeoutMs: Math.max(provider.timeoutMs, 10_000),
        maxBytes: 512 * 1024,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          ...(secret.apiKey && apiKeyHeader ? { [apiKeyHeader]: secret.apiKey } : {}),
          ...(secret.apiKey && !apiKeyHeader ? { authorization: `Bearer ${secret.apiKey}` } : {}),
        },
        body: multipartBody(parts, boundary),
      });
      responseText = response.bodyText;
    }
  } catch (error) {
    const message = error instanceof ToolError ? error.message : `The OCR provider request failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    await recordProviderOutcome(db, provider.slug, { ok: false, error: message });
    throw error instanceof ToolError ? error : new ToolError('PROVIDER_ERROR', message);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    await recordProviderOutcome(db, provider.slug, { ok: false, error: 'Non-JSON response' });
    throw new ToolError('PROVIDER_ERROR', 'The OCR provider did not return JSON. Check the provider configuration against its API documentation.');
  }

  const textPath = typeof provider.configuration.jsonPaths === 'object' && provider.configuration.jsonPaths !== null
    ? String((provider.configuration.jsonPaths as Record<string, unknown>).text ?? '')
    : '';
  const text = readPath(payload, textPath || 'text');
  if (typeof text !== 'string' || text.trim().length === 0) {
    await recordProviderOutcome(db, provider.slug, { ok: false, error: 'No text field in response' });
    throw new ToolError('PROVIDER_ERROR', 'The OCR provider returned a response without a text field. Set configuration.jsonPaths.text to the path of the recognised text in its response.');
  }

  const confidenceRaw = readPath(payload, textPath ? textPath.replace(/text$/, 'confidence') : 'confidence');
  const blocksRaw = readPath(payload, textPath ? textPath.replace(/text$/, 'blocks') : 'blocks');
  const blocks = Array.isArray(blocksRaw)
    ? blocksRaw.slice(0, 200).map((entry) => {
        const record = (entry ?? {}) as Record<string, unknown>;
        return {
          text: sanitizeUntrustedText(record.text ?? record.words ?? '', { maxLength: 400 }),
          confidence: typeof record.confidence === 'number' ? record.confidence : null,
        };
      })
    : [];

  await recordProviderOutcome(db, provider.slug, { ok: true });

  return {
    text,
    confidence: typeof confidenceRaw === 'number' ? confidenceRaw : null,
    language: language ?? null,
    blocks,
    provider: { name: provider.name, slug: provider.slug, kind: 'OCR' },
    durationMs: Date.now() - startedAt,
    notes: [
      'The image was forwarded to the configured OCR provider and was not stored by CloudHost247.',
      'OCR is a data-extraction tool, not a security control: text can be misread, especially on low-resolution images or unusual fonts. Verify anything important against the source image.',
      'Do not upload documents containing personal data unless the provider is contracted to process it.',
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Reverse image search
// ---------------------------------------------------------------------------------------------

export interface ReverseImageResult {
  provider: { name: string; slug: string };
  query: { mode: 'url' | 'multipart'; imageUrl: string | null; bytes: number | null };
  matches: Array<{ title: string | null; url: string; thumbnail: string | null; source: string | null; detail: string | null }>;
  otherResults: Array<{ title: string | null; url: string; detail: string | null }>;
  raw: Record<string, unknown>;
  durationMs: number;
  notes: string[];
}

export async function reverseImageSearch(db: Queryable, input: { image: ImagePayload }): Promise<ReverseImageResult> {
  const serp = await usableProviders(db, 'SERP');
  const others = await usableProviders(db, 'OTHER');
  const provider =
    serp.find((view) => view.configuration.capability === 'reverse-image-search') ??
    serp[0] ??
    others.find((view) => view.configuration.capability === 'reverse-image-search') ??
    null;

  if (!provider) {
    const anyConfigured = serp.length > 0 || others.length > 0;
    throw new ToolError(
      'CONFIGURATION_REQUIRED',
      anyConfigured
        ? 'No enabled provider is configured for reverse image search. A Super Admin must set configuration.capability = "reverse-image-search" on a SERP or OTHER provider under Admin → Tools → Providers.'
        : 'No SERP or OTHER provider is enabled, so reverse image search cannot run. A Super Admin must configure one under Admin → Tools → Providers.',
      { providerKind: 'SERP|OTHER', requiredSetting: 'configuration.capability = reverse-image-search' }
    );
  }
  const endpoint = requireEndpoint(provider.endpoint, provider.name);

  const secret = await providerSecret(db, provider.slug);
  const mode = provider.configuration.mode === 'multipart' ? 'multipart' : 'url';
  const fieldName = typeof provider.configuration.fieldName === 'string' ? provider.configuration.fieldName : 'image';
  const apiKeyHeader = typeof provider.configuration.apiKeyHeader === 'string' ? provider.configuration.apiKeyHeader : null;
  const pathTemplate = typeof provider.configuration.pathTemplate === 'string' ? provider.configuration.pathTemplate : null;

  const startedAt = Date.now();
  let payload: Record<string, unknown>;

  try {
    let imageUrl: string | null = null;
    let bytes: number | null = null;

    if (mode === 'url') {
      if (!input.image.url) {
        throw invalidInput(
          'This provider searches by image URL, so an upload cannot be used. Provide a public HTTPS image URL, or ask a Super Admin to configure a multipart provider for uploads.'
        );
      }
      imageUrl = await validateImageUrl(input.image.url);
      const requestUrl = pathTemplate
        ? `${endpoint.replace(/\/$/, '')}${pathTemplate.replace('{imageUrl}', encodeURIComponent(imageUrl))}`
        : `${endpoint.replace(/\/$/, '')}?image_url=${encodeURIComponent(imageUrl)}`;
      const response = await fetchWithGuard(requestUrl, {
        method: 'GET',
        timeoutMs: Math.max(provider.timeoutMs, 10_000),
        maxBytes: 1024 * 1024,
        headers: {
          accept: 'application/json',
          ...(secret.apiKey && apiKeyHeader ? { [apiKeyHeader]: secret.apiKey } : {}),
          ...(secret.apiKey && !apiKeyHeader ? { authorization: `Bearer ${secret.apiKey}` } : {}),
        },
      });
      if (response.status !== 200) throw new ToolError('PROVIDER_ERROR', `The reverse image provider answered HTTP ${response.status}.`);
      payload = JSON.parse(response.bodyText) as Record<string, unknown>;
    } else {
      const decoded = decodeImage(input.image);
      bytes = decoded.buffer.length;
      const boundary = `ch247${randomBytes(12).toString('hex')}`;
      const response = await fetchWithGuard(endpoint.replace(/\/$/, '') + (pathTemplate ?? ''), {
        method: 'POST',
        timeoutMs: Math.max(provider.timeoutMs, 15_000),
        maxBytes: 1024 * 1024,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          ...(secret.apiKey && apiKeyHeader ? { [apiKeyHeader]: secret.apiKey } : {}),
          ...(secret.apiKey && !apiKeyHeader ? { authorization: `Bearer ${secret.apiKey}` } : {}),
        },
        body: multipartBody([{ name: fieldName, filename: 'image', contentType: decoded.mimeType, data: decoded.buffer }], boundary),
      });
      if (response.status !== 200) throw new ToolError('PROVIDER_ERROR', `The reverse image provider answered HTTP ${response.status}.`);
      payload = JSON.parse(response.bodyText) as Record<string, unknown>;
    }

    const resultsPath = typeof provider.configuration.jsonPaths === 'object' && provider.configuration.jsonPaths !== null
      ? String((provider.configuration.jsonPaths as Record<string, unknown>).matches ?? '')
      : '';
    const rawMatches = readPath(payload, resultsPath || 'matches');
    const matches = (Array.isArray(rawMatches) ? rawMatches : []).slice(0, 50).map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      return {
        title: record.title ? sanitizeUntrustedText(record.title, { maxLength: 200 }) : null,
        url: sanitizeUntrustedText(record.url ?? record.link ?? '', { maxLength: 500 }),
        thumbnail: record.thumbnail ? sanitizeUntrustedText(record.thumbnail, { maxLength: 500 }) : null,
        source: record.source ? sanitizeUntrustedText(record.source, { maxLength: 120 }) : null,
        detail: record.detail ? sanitizeUntrustedText(record.detail, { maxLength: 300 }) : null,
      };
    }).filter((match) => match.url.length > 0);

    const otherRaw = readPath(payload, 'results');
    const otherResults = (Array.isArray(otherRaw) ? otherRaw : []).slice(0, 50).map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      return {
        title: record.title ? sanitizeUntrustedText(record.title, { maxLength: 200 }) : null,
        url: sanitizeUntrustedText(record.url ?? record.link ?? '', { maxLength: 500 }),
        detail: record.detail ? sanitizeUntrustedText(record.detail, { maxLength: 300 }) : null,
      };
    }).filter((entry) => entry.url.length > 0);

    await recordProviderOutcome(db, provider.slug, { ok: true });

    return {
      provider: { name: provider.name, slug: provider.slug },
      query: { mode, imageUrl: mode === 'url' ? (input.image.url ?? null) : null, bytes },
      matches,
      otherResults,
      raw: payload,
      durationMs: Date.now() - startedAt,
      notes: [
        'Reverse image search results come from the configured provider and describe where that provider believes the image appears. CloudHost247 has not downloaded or verified those pages.',
        'Finding a match does not establish who owns an image or whether a use is licensed. For a takedown or a licence dispute, verify on the destination site.',
        'The image was forwarded to the provider; it was not stored by CloudHost247.',
      ],
    };
  } catch (error) {
    const message = error instanceof ToolError ? error.message : `The reverse image search failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    await recordProviderOutcome(db, provider.slug, { ok: false, error: message });
    throw error instanceof ToolError ? error : new ToolError('PROVIDER_ERROR', message);
  }
}
