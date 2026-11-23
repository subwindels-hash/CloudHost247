/**
 * PHP configuration (A08 — A Hosting).
 *
 * Stores PHP version and per-service settings. This is an internal
 * configuration store only — no PHP-FPM provider or control panel is called
 * to apply the version. Honest about the absence of a PHP runtime provider
 * rather than fabricating PHP configuration changes.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

export interface PhpConfigRow {
  id: string;
  service_id: string;
  php_version: string;
  settings: Record<string, unknown>;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ListPhpConfigsFilters {
  service_id?: string;
  php_version?: string;
}

export async function listPhpConfigs(
  db: Queryable,
  filters: ListPhpConfigsFilters = {},
): Promise<PhpConfigRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.service_id) {
    params.push(filters.service_id);
    conditions.push(`service_id = $${params.length}`);
  }
  if (filters.php_version) {
    params.push(filters.php_version);
    conditions.push(`php_version = $${params.length}`);
  }

  const { rows } = await db.query<PhpConfigRow>(
    `SELECT id, service_id, php_version, settings, updated_by, created_at, updated_at
     FROM php_configs
     ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

export async function getPhpConfig(
  db: Queryable,
  id: string,
): Promise<PhpConfigRow | null> {
  const { rows } = await db.query<PhpConfigRow>(
    `SELECT id, service_id, php_version, settings, updated_by, created_at, updated_at
     FROM php_configs
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getPhpConfigByService(
  db: Queryable,
  serviceId: string,
): Promise<PhpConfigRow | null> {
  const { rows } = await db.query<PhpConfigRow>(
    `SELECT id, service_id, php_version, settings, updated_by, created_at, updated_at
     FROM php_configs
     WHERE service_id = $1`,
    [serviceId],
  );
  return rows[0] ?? null;
}

export interface UpsertPhpConfigInput {
  service_id: string;
  php_version?: string;
  settings?: Record<string, unknown>;
  updated_by?: string | null;
}

export async function upsertPhpConfig(
  db: Queryable,
  input: UpsertPhpConfigInput,
): Promise<PhpConfigRow> {
  const existing = await getPhpConfigByService(db, input.service_id);
  if (existing) {
    const { rows } = await db.query<PhpConfigRow>(
      `UPDATE php_configs
       SET php_version = COALESCE($1, php_version),
           settings = COALESCE($2, settings),
           updated_by = COALESCE($3, updated_by),
           updated_at = now()
       WHERE service_id = $4
       RETURNING id, service_id, php_version, settings, updated_by, created_at, updated_at`,
      [input.php_version ?? null,
       input.settings === undefined ? null : JSON.stringify(input.settings),
       input.updated_by ?? null,
       input.service_id],
    );
    return rows[0]!;
  }

  const { rows } = await db.query<PhpConfigRow>(
    `INSERT INTO php_configs (id, service_id, php_version, settings, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     RETURNING id, service_id, php_version, settings, updated_by, created_at, updated_at`,
    [randomUUID(), input.service_id, input.php_version ?? '8.2',
     input.settings === undefined ? {} : input.settings,
     input.updated_by ?? null],
  );
  return rows[0]!;
}

export async function deletePhpConfig(
  db: Queryable,
  id: string,
): Promise<PhpConfigRow | null> {
  const { rows } = await db.query<PhpConfigRow>(
    `DELETE FROM php_configs
     WHERE id = $1
     RETURNING id, service_id, php_version, settings, updated_by, created_at, updated_at`,
    [id],
  );
  return rows[0] ?? null;
}
