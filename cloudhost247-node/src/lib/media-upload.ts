/**
 * Shared upload validation for in-database media (Website Builder library, store digital products,
 * expert-service attachments).
 *
 * Everything about an uploaded file is re-derived server-side; nothing the client claims is
 * trusted. This extends the rules already enforced for profile images (src/lib/image-upload.ts) to
 * the additional content types a website library and a digital-product catalogue legitimately need:
 *
 *   - the declared content type must be in the whitelist AND the decoded bytes must match that
 *     type's magic number, so a PNG cannot be relabelled as a PDF (or vice versa) to smuggle
 *     something past the check;
 *   - SVG, HTML and scripts are rejected outright — an "image" that is an XML document is a
 *     script-delivery vector, not an image;
 *   - the size cap applies to the decoded bytes, not to the base64 string;
 *   - the stored filename is normalised to a slug plus the extension implied by the *detected*
 *     type, so the original name can never carry a path or a second extension.
 */
import { createHash } from 'node:crypto';
import { ValidationError } from './errors';

/** 2 MiB for media library uploads (matched by the builder_media CHECK constraint). */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
/** 10 MiB for digital-product downloads (matched by the store_products CHECK constraint). */
export const MAX_DIGITAL_PRODUCT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/csv': 'csv',
} as const;

export type AllowedUploadType = keyof typeof ALLOWED_UPLOAD_TYPES;

export function isAllowedUploadType(value: string): value is AllowedUploadType {
  return Object.prototype.hasOwnProperty.call(ALLOWED_UPLOAD_TYPES, value);
}

/** Detects the real type from leading bytes; null for anything unrecognised (SVG/HTML included). */
export function sniffUploadType(bytes: Buffer): AllowedUploadType | null {
  if (bytes.length < 8) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    return 'application/zip';
  }
  // Text formats: printable ASCII/UTF-8 only, no markup that could execute in a browser context.
  const head = bytes.subarray(0, 512).toString('utf8');
  if (/^[\t\n\r\x20-\x7e\u00a0-\uffff]*$/.test(head)) {
    return /,/.test(head.split('\n')[0] ?? '') ? 'text/csv' : 'text/plain';
  }
  return null;
}

export interface ValidatedUpload {
  contentType: AllowedUploadType;
  filename: string;
  data: Buffer;
  byteSize: number;
  checksum: string;
}

/**
 * Decodes a base64 payload, validates it against the declared type and the size cap, and returns
 * the normalised filename + checksum ready to store.
 */
export function decodeAndValidateUpload(
  base64: string,
  declaredContentType: string,
  originalFilename: string,
  maxBytes: number = MAX_MEDIA_BYTES
): ValidatedUpload {
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new ValidationError('The uploaded file is empty');
  }
  // Reject oversized payloads before decoding: base64 inflates by ~4/3, so anything beyond that
  // ratio cannot be within the limit even in principle.
  if (base64.length > Math.ceil((maxBytes * 4) / 3) + 1024) {
    throw new ValidationError(`That file is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`);
  }
  if (!isAllowedUploadType(declaredContentType)) {
    throw new ValidationError(
      `Unsupported file type "${declaredContentType}". Allowed: ${Object.keys(ALLOWED_UPLOAD_TYPES).join(', ')}`
    );
  }

  let data: Buffer;
  try {
    data = Buffer.from(base64, 'base64');
  } catch {
    throw new ValidationError('The uploaded file could not be decoded');
  }
  if (data.length === 0) throw new ValidationError('The uploaded file is empty');
  if (data.length > maxBytes) {
    throw new ValidationError(`That file is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`);
  }

  const detected = sniffUploadType(data);
  if (!detected) {
    throw new ValidationError('That file’s contents do not match any supported format');
  }
  if (detected !== declaredContentType) {
    throw new ValidationError(
      `The file contents are ${detected}, which does not match the declared type ${declaredContentType}`
    );
  }

  return {
    contentType: detected,
    filename: normalizeFilename(originalFilename, ALLOWED_UPLOAD_TYPES[detected]),
    data,
    byteSize: data.length,
    checksum: createHash('sha256').update(data).digest('hex'),
  };
}

/**
 * Server-chosen, traversal-proof filename: a slug of the stems the client sent (never its path)
 * plus the extension implied by the DETECTED type. The original name is therefore only ever usable
 * as a hint for the display name, never as a path.
 */
export function normalizeFilename(originalFilename: string, extension: string): string {
  const stem = (originalFilename || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return `${stem || 'file'}.${extension}`;
}
