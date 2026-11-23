/**
 * Website access sharing (J03 — J Agency).
 *
 * Lets an agency client grant view/edit access to one of their builder_sites
 * to another user. This is an internal access-control store only — no
 * external SSO/OAuth provider is called. Honest about the absence of
 * cross-platform sharing rather than fabricating provider-backed access.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

export interface WebsiteAccessShareRow {
  id: string;
  site_id: string;
  granted_to_user_id: string;
  granted_by_user_id: string;
  permission_level: 'viewer' | 'editor';
  status: 'active' | 'revoked';
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ListWebsiteAccessSharesFilters {
  site_id?: string;
  granted_to_user_id?: string;
  granted_by_user_id?: string;
  status?: 'active' | 'revoked';
}

export async function listWebsiteAccessShares(
  db: Queryable,
  filters: ListWebsiteAccessSharesFilters = {},
): Promise<WebsiteAccessShareRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.site_id) {
    params.push(filters.site_id);
    conditions.push(`site_id = $${params.length}`);
  }
  if (filters.granted_to_user_id) {
    params.push(filters.granted_to_user_id);
    conditions.push(`granted_to_user_id = $${params.length}`);
  }
  if (filters.granted_by_user_id) {
    params.push(filters.granted_by_user_id);
    conditions.push(`granted_by_user_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }

  const { rows } = await db.query<WebsiteAccessShareRow>(
    `SELECT id, site_id, granted_to_user_id, granted_by_user_id, permission_level, status, expires_at, created_at, updated_at
     FROM website_access_shares
     ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

export async function getWebsiteAccessShare(
  db: Queryable,
  id: string,
): Promise<WebsiteAccessShareRow | null> {
  const { rows } = await db.query<WebsiteAccessShareRow>(
    `SELECT id, site_id, granted_to_user_id, granted_by_user_id, permission_level, status, expires_at, created_at, updated_at
     FROM website_access_shares
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface CreateWebsiteAccessShareInput {
  site_id: string;
  granted_to_user_id: string;
  granted_by_user_id: string;
  permission_level?: 'viewer' | 'editor';
  expires_at?: Date | null;
}

export async function createWebsiteAccessShare(
  db: Queryable,
  input: CreateWebsiteAccessShareInput,
): Promise<WebsiteAccessShareRow> {
  const { rows } = await db.query<WebsiteAccessShareRow>(
    `INSERT INTO website_access_shares (id, site_id, granted_to_user_id, granted_by_user_id, permission_level, status, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, now(), now())
     RETURNING id, site_id, granted_to_user_id, granted_by_user_id, permission_level, status, expires_at, created_at, updated_at`,
    [
      randomUUID(),
      input.site_id,
      input.granted_to_user_id,
      input.granted_by_user_id,
      input.permission_level ?? 'viewer',
      input.expires_at ?? null,
    ],
  );
  return rows[0]!;
}

export interface UpdateWebsiteAccessShareInput {
  permission_level?: 'viewer' | 'editor';
  status?: 'active' | 'revoked';
  expires_at?: Date | null;
}

export async function updateWebsiteAccessShare(
  db: Queryable,
  id: string,
  input: UpdateWebsiteAccessShareInput,
): Promise<WebsiteAccessShareRow | null> {
  const { rows } = await db.query<WebsiteAccessShareRow>(
    `UPDATE website_access_shares
     SET permission_level = COALESCE($1, permission_level),
         status = COALESCE($2, status),
         expires_at = $3,
         updated_at = now()
     WHERE id = $4
     RETURNING id, site_id, granted_to_user_id, granted_by_user_id, permission_level, status, expires_at, created_at, updated_at`,
    [input.permission_level ?? null, input.status ?? null, input.expires_at ?? null, id],
  );
  return rows[0] ?? null;
}

export async function revokeWebsiteAccessShare(
  db: Queryable,
  id: string,
): Promise<WebsiteAccessShareRow | null> {
  const { rows } = await db.query<WebsiteAccessShareRow>(
    `UPDATE website_access_shares
     SET status = 'revoked', updated_at = now()
     WHERE id = $1 AND status = 'active'
     RETURNING id, site_id, granted_to_user_id, granted_by_user_id, permission_level, status, expires_at, created_at, updated_at`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listSitesSharedWithUser(
  db: Queryable,
  userId: string,
): Promise<WebsiteAccessShareRow[]> {
  return listWebsiteAccessShares(db, { granted_to_user_id: userId, status: 'active' });
}

export async function listSharesForSite(
  db: Queryable,
  siteId: string,
): Promise<WebsiteAccessShareRow[]> {
  return listWebsiteAccessShares(db, { site_id: siteId, status: 'active' });
}
