/**
 * Profile images (spec §28–§30).
 *
 * Storage decision: bytes live in `user_profile_images` in the platform's own database rather
 * than on the filesystem or in a new object store. The supported deployment target is cPanel +
 * Passenger (docs/CPANEL_DEPLOYMENT.md) where the application directory is redeployed wholesale
 * and no object-storage credentials exist; putting avatars in the database keeps them backed up,
 * replicated, and access-controlled by exactly the same mechanisms as everything else, and
 * avoids handing the web server a user-writable public directory.
 *
 * Safety rules enforced together with src/lib/image-upload.ts:
 *   - the stored key is `id` (a server-generated uuid) — client filenames are never trusted or
 *     reused, so no path traversal and no attacker-chosen extension;
 *   - the content type is whitelisted (PNG/JPEG/WebP/GIF) *and* re-checked against the file's
 *     magic bytes, so SVG, HTML and scripts cannot be stored or replayed;
 *   - bytes are only ever served with the stored, whitelisted content type plus
 *     Content-Disposition: attachment-safe headers by the route.
 */
import type { Queryable } from './types';

export interface ProfileImageRow {
  id: string;
  user_id: string;
  content_type: string;
  byte_size: number;
  checksum: string;
  data: Buffer | Uint8Array | string;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfileImageMeta = Omit<ProfileImageRow, 'data'>;

const META_COLUMNS = 'id, user_id, content_type, byte_size, checksum, uploaded_by, created_at, updated_at';

export async function upsertProfileImage(
  db: Queryable,
  input: {
    id: string;
    userId: string;
    contentType: string;
    data: Buffer;
    checksum: string;
    uploadedBy: string;
  }
): Promise<ProfileImageMeta> {
  const { rows } = await db.query<ProfileImageMeta>(
    `INSERT INTO user_profile_images (id, user_id, content_type, byte_size, checksum, data, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE
       SET content_type = EXCLUDED.content_type,
           byte_size = EXCLUDED.byte_size,
           checksum = EXCLUDED.checksum,
           data = EXCLUDED.data,
           uploaded_by = EXCLUDED.uploaded_by,
           updated_at = now()
     RETURNING ${META_COLUMNS}`,
    [input.id, input.userId, input.contentType, input.data.length, input.checksum, input.data, input.uploadedBy]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to store profile image');
  return row;
}

export async function getProfileImageMeta(db: Queryable, userId: string): Promise<ProfileImageMeta | null> {
  const { rows } = await db.query<ProfileImageMeta>(
    `SELECT ${META_COLUMNS} FROM user_profile_images WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function getProfileImage(db: Queryable, userId: string): Promise<ProfileImageRow | null> {
  const { rows } = await db.query<ProfileImageRow>('SELECT * FROM user_profile_images WHERE user_id = $1 LIMIT 1', [
    userId,
  ]);
  return rows[0] ?? null;
}

export async function deleteProfileImage(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>('DELETE FROM user_profile_images WHERE user_id = $1 RETURNING id', [
    userId,
  ]);
  return rows.length > 0;
}
