/**
 * Phase 6 — repository for application_categories (spec §7).
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

export interface ApplicationCategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertCategoryInput {
  id?: string;
  name: string;
  slug: string;
  description?: string | null;
  iconUrl?: string | null;
  sortOrder?: number;
  active?: boolean;
}

export async function createCategory(db: Queryable, input: UpsertCategoryInput): Promise<ApplicationCategoryRow> {
  const { rows } = await db.query<ApplicationCategoryRow>(
    `INSERT INTO application_categories (id, name, slug, description, icon_url, sort_order, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      input.id ?? randomUUID(),
      input.name,
      input.slug,
      input.description ?? null,
      input.iconUrl ?? null,
      input.sortOrder ?? 0,
      input.active ?? true,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('createCategory: insert returned no row');
  return row;
}

export async function findCategoryBySlug(db: Queryable, slug: string): Promise<ApplicationCategoryRow | null> {
  const { rows } = await db.query<ApplicationCategoryRow>(
    `SELECT * FROM application_categories WHERE lower(slug) = lower($1)`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function listCategories(db: Queryable, onlyActive = true): Promise<ApplicationCategoryRow[]> {
  const { rows } = await db.query<ApplicationCategoryRow>(
    `SELECT * FROM application_categories ${onlyActive ? 'WHERE active = true' : ''}
     ORDER BY sort_order ASC, name ASC`
  );
  return rows;
}

export async function updateCategory(
  db: Queryable,
  id: string,
  patch: Partial<UpsertCategoryInput>
): Promise<ApplicationCategoryRow | null> {
  const current = await db.query<ApplicationCategoryRow>(`SELECT * FROM application_categories WHERE id = $1`, [id]);
  const existing = current.rows[0];
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  const { rows } = await db.query<ApplicationCategoryRow>(
    `UPDATE application_categories
     SET name = $2, description = $3, icon_url = $4, sort_order = $5, active = $6, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, merged.name, merged.description, merged.icon_url, merged.sort_order, merged.active]
  );
  return rows[0] ?? null;
}
