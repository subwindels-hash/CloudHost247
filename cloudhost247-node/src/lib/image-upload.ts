/**
 * Profile-image validation (spec §29).
 *
 * Uploads arrive as a base64 payload on the existing JSON API (this platform has no multipart
 * pipeline; adding one only for avatars would widen the attack surface for no gain). Everything
 * about the file is therefore re-derived server-side and nothing the client claims is trusted:
 *
 *   - the declared content type must be in the whitelist, AND the decoded bytes' magic number
 *     must match it — a PNG header cannot be mislabelled as, or hidden inside, anything else;
 *   - SVG is rejected outright (it is an XML document that can carry script), as is anything
 *     that is not one of the four raster formats below;
 *   - the size cap is applied to the *decoded* bytes, not the base64 string;
 *   - the stored object's name is a server-generated uuid; the client's filename is used only to
 *     re-check the extension and is otherwise discarded.
 */
import { createHash } from 'node:crypto';
import { ValidationError } from './errors';

export const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MiB, matched by a CHECK constraint.

export const ALLOWED_IMAGE_TYPES = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
} as const;

export type AllowedImageType = keyof typeof ALLOWED_IMAGE_TYPES;

export function isAllowedImageType(value: string): value is AllowedImageType {
  return Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, value);
}

/** Detects the real format from the leading bytes. Returns null for anything unrecognized —
 * including SVG/XML/HTML/scripts, which therefore can never be stored. */
export function sniffImageType(bytes: Buffer): AllowedImageType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export interface ValidatedImage {
  contentType: AllowedImageType;
  data: Buffer;
  byteSize: number;
  checksum: string;
}

const DATA_URL_PATTERN = /^data:([a-zA-Z0-9.+/-]+);base64,(.*)$/s;

/**
 * Validates a client-supplied image. `payload` accepts either a bare base64 string or a
 * `data:<mime>;base64,<...>` URL; when a data URL declares a type it must agree with both the
 * explicit `contentType` (if given) and the sniffed bytes.
 */
export function validateProfileImageUpload(input: {
  data: string;
  contentType?: string;
  fileName?: string;
}): ValidatedImage {
  const match = DATA_URL_PATTERN.exec(input.data.trim());
  const declaredFromUrl = match?.[1];
  const base64 = (match?.[2] ?? input.data).replace(/\s+/g, '');

  if (base64.length === 0) throw new ValidationError('Image data is required');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ValidationError('Image data must be base64-encoded');

  // Reject oversize payloads before allocating the decoded buffer (base64 is 4/3 of the bytes).
  if ((base64.length * 3) / 4 > MAX_PROFILE_IMAGE_BYTES + 1024) {
    throw new ValidationError(`Image must be ${Math.floor(MAX_PROFILE_IMAGE_BYTES / 1024 / 1024)} MB or smaller`);
  }

  const declared = input.contentType ?? declaredFromUrl;
  if (declared && !isAllowedImageType(declared)) {
    throw new ValidationError('Unsupported image type. Use PNG, JPEG, WebP or GIF.');
  }
  if (declared && declaredFromUrl && declared !== declaredFromUrl) {
    throw new ValidationError('Image type does not match the uploaded data');
  }

  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw new ValidationError('Image data is required');
  if (bytes.length > MAX_PROFILE_IMAGE_BYTES) {
    throw new ValidationError(`Image must be ${Math.floor(MAX_PROFILE_IMAGE_BYTES / 1024 / 1024)} MB or smaller`);
  }

  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    throw new ValidationError('That file is not a supported image. Use PNG, JPEG, WebP or GIF.');
  }
  if (declared && declared !== sniffed) {
    throw new ValidationError('Image contents do not match the declared image type');
  }

  if (input.fileName) {
    const extension = input.fileName.includes('.') ? input.fileName.split('.').pop()!.toLowerCase() : '';
    const allowedExtensions: readonly string[] = ALLOWED_IMAGE_TYPES[sniffed];
    if (!allowedExtensions.includes(extension)) {
      throw new ValidationError(`File extension ".${extension}" does not match the image type ${sniffed}`);
    }
  }

  return {
    contentType: sniffed,
    data: bytes,
    byteSize: bytes.length,
    checksum: createHash('sha256').update(bytes).digest('hex'),
  };
}
