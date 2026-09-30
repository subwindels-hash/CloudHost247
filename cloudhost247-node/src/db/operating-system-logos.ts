import { createHash } from 'node:crypto';
import type { Queryable } from './types';

export const MAX_OS_LOGO_BYTES = 512 * 1024;
export type OsLogoContentType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface OperatingSystemLogoAssetRow {
  operating_system_id: string;
  content_type: OsLogoContentType;
  content: Buffer | Uint8Array;
  byte_size: number;
  sha256: string;
  original_filename: string;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

function hasBytes(content: Buffer, expected: number[], offset = 0): boolean {
  return expected.every((byte, index) => content[offset + index] === byte);
}

/**
 * Verifies the bytes rather than trusting the browser-supplied media type. SVG uploads are not
 * accepted: the reviewed SVGs shipped with the application remain available as static assets,
 * while operator uploads are limited to inert raster formats.
 */
export function validateOsLogoBytes(contentType: OsLogoContentType, content: Buffer): void {
  if (content.length === 0 || content.length > MAX_OS_LOGO_BYTES) {
    throw new Error(`Logo must be between 1 byte and ${MAX_OS_LOGO_BYTES} bytes`);
  }
  const valid = contentType === 'image/png'
    ? hasBytes(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : contentType === 'image/jpeg'
      ? hasBytes(content, [0xff, 0xd8, 0xff])
      : hasBytes(content, [0x52, 0x49, 0x46, 0x46])
        && hasBytes(content, [0x57, 0x45, 0x42, 0x50], 8);
  if (!valid) throw new Error(`Uploaded bytes are not a valid ${contentType} image`);
}

export async function findOperatingSystemLogo(
  db: Queryable,
  operatingSystemId: string
): Promise<OperatingSystemLogoAssetRow | null> {
  const { rows } = await db.query<OperatingSystemLogoAssetRow>(
    `SELECT * FROM operating_system_logo_assets WHERE operating_system_id=$1`,
    [operatingSystemId]
  );
  return rows[0] ?? null;
}

export async function upsertOperatingSystemLogo(
  db: Queryable,
  input: {
    operatingSystemId: string;
    contentType: OsLogoContentType;
    content: Buffer;
    originalFilename: string;
    uploadedBy: string;
  }
): Promise<Pick<OperatingSystemLogoAssetRow, 'operating_system_id' | 'content_type' | 'byte_size' | 'sha256' | 'original_filename' | 'created_at' | 'updated_at'>> {
  validateOsLogoBytes(input.contentType, input.content);
  const sha256 = createHash('sha256').update(input.content).digest('hex');
  const { rows } = await db.query<OperatingSystemLogoAssetRow>(
    `INSERT INTO operating_system_logo_assets
       (operating_system_id,content_type,content,byte_size,sha256,original_filename,uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (operating_system_id) DO UPDATE SET
       content_type=excluded.content_type,content=excluded.content,byte_size=excluded.byte_size,
       sha256=excluded.sha256,original_filename=excluded.original_filename,
       uploaded_by=excluded.uploaded_by,updated_at=now()
     RETURNING operating_system_id,content_type,byte_size,sha256,original_filename,created_at,updated_at`,
    [input.operatingSystemId,input.contentType,input.content,input.content.length,sha256,input.originalFilename,input.uploadedBy]
  );
  const row = rows[0];
  if (!row) throw new Error('upsertOperatingSystemLogo: insert returned no row');
  return row;
}

export async function deleteOperatingSystemLogo(db: Queryable, operatingSystemId: string): Promise<boolean> {
  const { rows } = await db.query(
    `DELETE FROM operating_system_logo_assets WHERE operating_system_id=$1 RETURNING operating_system_id`,
    [operatingSystemId]
  );
  return rows.length > 0;
}
