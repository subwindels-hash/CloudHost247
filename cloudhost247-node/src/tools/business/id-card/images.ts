/**
 * Upload validation for photographs, logos and signatures.
 *
 * An uploaded image ends up printed on an identity document, so the checks are strict and the
 * reasons are specific: an SVG is refused (it is a script container, and the card only needs pixels),
 * a 20 MB photo is refused with the limit stated, a 40 × 40 px photograph is refused because it will
 * print as mush at 300 dpi, and a file whose bytes are not the format it claims is refused rather
 * than decoded.
 *
 * The byte-level check matters most: `file.type` is attacker-controlled and a mislabelled file that
 * decodes to a broken image is how a badge ends up with a blank rectangle where the face should be.
 */

export const IMAGE_RULES = {
  /** Formats a card can actually use. SVG is excluded on purpose: it can carry script. */
  allowedTypes: ['image/png', 'image/jpeg', 'image/webp'] as const,
  maxBytes: 6 * 1024 * 1024,
  /** Below this, the print is unusable at 300 dpi. */
  minWidth: 240,
  minHeight: 240,
  /** Above this the browser struggles to draw hundreds of badges in one batch. */
  maxWidth: 4000,
  maxHeight: 4000,
} as const;

export type ImageKind = 'photo' | 'logo' | 'signature';

export interface ImageFileLike {
  name?: string;
  type?: string;
  size: number;
  /** First bytes of the file, when the caller can supply them (browser: slice of the File). */
  head?: Uint8Array;
}

export interface ImageValidation {
  ok: boolean;
  message: string;
  /** Advisory that does not stop the upload. */
  warning?: string;
}

/** Magic-number detection. The declared MIME type is never trusted on its own. */
export function detectImageType(head: Uint8Array | undefined): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (!head || head.length < 12) return null;
  const byte = (index: number): number => head[index] ?? 0;
  if (byte(0) === 0x89 && byte(1) === 0x50 && byte(2) === 0x4e && byte(3) === 0x47) return 'image/png';
  if (byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff) return 'image/jpeg';
  const riff = String.fromCharCode(byte(0), byte(1), byte(2), byte(3));
  const webp = String.fromCharCode(byte(8), byte(9), byte(10), byte(11));
  if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  return null;
}

export function validateImageFile(kind: ImageKind, file: ImageFileLike): ImageValidation {
  const label = kind === 'logo' ? 'logo' : kind === 'signature' ? 'signature' : 'photograph';
  if (file.size <= 0) return { ok: false, message: `That ${label} file is empty.` };
  if (file.size > IMAGE_RULES.maxBytes) {
    return {
      ok: false,
      message: `That ${label} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${IMAGE_RULES.maxBytes / 1024 / 1024} MB — resize it before uploading, because a badge only needs about 1000 px across.`,
    };
  }
  const detected = detectImageType(file.head);
  if (detected === null) {
    return {
      ok: false,
      message: `That file is not a PNG, JPEG or WebP image.${file.name ? ` (“${file.name}”)` : ''} Screenshots saved as PDF or vector art saved as SVG cannot be used: an SVG can contain scripts, so it is refused even though it would look correct.`,
    };
  }
  if (file.type && !IMAGE_RULES.allowedTypes.includes(file.type as (typeof IMAGE_RULES.allowedTypes)[number])) {
    return { ok: false, message: `The file is a ${file.type} file. Use PNG, JPEG or WebP.` };
  }
  if (file.type && detected !== file.type) {
    return { ok: false, message: `The file is named as ${file.type} but its contents are ${detected}. Re-export it and try again.` };
  }
  return { ok: true, message: 'OK' };
}

export function validateImageDimensions(kind: ImageKind, width: number, height: number): ImageValidation {
  const label = kind === 'logo' ? 'logo' : kind === 'signature' ? 'signature' : 'photograph';
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, message: `The ${label} could not be decoded, so its size is unknown. It may be corrupt or only partly downloaded.` };
  }
  if (width < IMAGE_RULES.minWidth || height < IMAGE_RULES.minHeight) {
    return {
      ok: false,
      message: `That ${label} is ${width} × ${height} px. At 300 dpi it would print below ${IMAGE_RULES.minWidth} px across and look blurry on the card — use an image of at least ${IMAGE_RULES.minWidth} × ${IMAGE_RULES.minHeight} px.`,
    };
  }
  if (width > IMAGE_RULES.maxWidth || height > IMAGE_RULES.maxHeight) {
    return {
      ok: false,
      message: `That ${label} is ${width} × ${height} px, larger than the ${IMAGE_RULES.maxWidth} px limit. Resize it to roughly 1000 px across for the card.`,
    };
  }
  if (kind === 'photo' && height > width * 2) {
    return { ok: true, message: 'OK', warning: 'That photograph is very tall for its width; the card will crop the top and bottom to fill the photo frame.' };
  }
  if (kind === 'photo' && width > height * 1.5) {
    return { ok: true, message: 'OK', warning: 'That photograph is very wide for its height; the card will crop the sides to fill the photo frame.' };
  }
  return { ok: true, message: 'OK' };
}

/** Decode a data URL's MIME type, for the images carried in from local storage or a CSV import. */
export function dataUrlType(value: string): string | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(value);
  return match?.[1]?.toLowerCase() ?? null;
}

/** A data URL this tool accepts: base64 PNG/JPEG/WebP, nothing else. */
export function validateDataUrl(value: string, kind: ImageKind = 'photo'): ImageValidation {
  if (value.trim() === '') return { ok: false, message: 'Empty image.' };
  const type = dataUrlType(value);
  if (!type) return { ok: false, message: `That ${kind} is not a base64 data URL.` };
  if (type === null || !IMAGE_RULES.allowedTypes.includes(type as (typeof IMAGE_RULES.allowedTypes)[number])) {
    return { ok: false, message: `A ${type ?? 'unknown'} image cannot be used here; PNG, JPEG or WebP only.` };
  }
  if (value.length > IMAGE_RULES.maxBytes * 1.4) {
    return { ok: false, message: `That ${kind} is larger than the ${IMAGE_RULES.maxBytes / 1024 / 1024} MB limit.` };
  }
  return { ok: true, message: 'OK' };
}
