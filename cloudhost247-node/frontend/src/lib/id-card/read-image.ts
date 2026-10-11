/**
 * Reading an uploaded file into a data URL, in the browser.
 *
 * The rules live in `src/tools/business/id-card/images.ts` and are shared with the API and the test
 * suite; this file only does the DOM part — FileReader and Image decode — and applies those rules.
 * Splitting them this way is what allows the validation to be tested without a browser and the
 * browser code to stay small enough to reason about.
 */

import { validateImageDimensions, validateImageFile, type ImageKind } from '../../../../src/tools/business/id-card/images';

export interface ReadImageSuccess {
  ok: true;
  dataUrl: string;
  width: number;
  height: number;
  warning?: string;
}

export interface ReadImageFailure {
  ok: false;
  message: string;
}

function loadDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => reject(new Error('decode failed'));
    image.src = dataUrl;
  });
}

export async function readImageFile(kind: ImageKind, file: File): Promise<ReadImageSuccess | ReadImageFailure> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const basic = validateImageFile(kind, { name: file.name, type: file.type, size: file.size, head });
  if (!basic.ok) return { ok: false, message: basic.message };

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });

  try {
    const size = await loadDimensions(dataUrl);
    const dimension = validateImageDimensions(kind, size.width, size.height);
    if (!dimension.ok) return { ok: false, message: dimension.message };
    const warning = [basic.warning, dimension.warning].filter(Boolean).join(' ') || undefined;
    return { ok: true, dataUrl, width: size.width, height: size.height, warning };
  } catch {
    return { ok: false, message: 'That image could not be decoded — it may be corrupt or only partly downloaded.' };
  }
}
