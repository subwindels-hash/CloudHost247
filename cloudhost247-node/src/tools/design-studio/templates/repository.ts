/**
 * Design Studio — saved-template persistence.
 *
 * One repository for all four studios (label, shipping, VDA, business card), because they all save
 * the same shape: a document, a name, an owner and a kind. The kind is a column rather than four
 * tables so "duplicate this label as a shipping label" is a copy with a new kind, and so the
 * ownership rule is written once.
 *
 * ## Ownership
 *
 * Every read and write is scoped by `user_id`. `getTemplate` takes the owner as a required argument
 * rather than resolving it internally, so a caller cannot accidentally fetch another account's
 * template by forgetting a `WHERE`. A template that exists but belongs to someone else is reported as
 * `NOT_FOUND`, not `FORBIDDEN` — a 403 on an id confirms the id exists, which is a small information
 * leak and, more importantly, gives the caller nothing to do.
 *
 * System templates are never rows in this table. They are code (`labels/templates.ts` and siblings),
 * so there is no path — not an admin one, not a SQL one — by which a user overwrites them.
 */

import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../../db/types';
import { ConflictError, NotFoundError, ValidationError } from '../../../lib/errors';

export type TemplateKind = 'label' | 'shipping' | 'vda' | 'card';

export const TEMPLATE_KINDS: readonly TemplateKind[] = ['label', 'shipping', 'vda', 'card'];

export interface SavedTemplate {
  id: string;
  userId: string;
  kind: TemplateKind;
  name: string;
  summary: string;
  document: Record<string, unknown>;
  sourceTemplate: string | null;
  /** Increments on every overwrite. Clients send the one they loaded so a stale save is refused. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateListItem {
  id: string;
  kind: TemplateKind;
  name: string;
  summary: string;
  sourceTemplate: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** A saved template as the API publishes it: everything except the owner. */
export function publicTemplate(template: SavedTemplate): Omit<SavedTemplate, 'userId'> {
  const { userId: _userId, ...rest } = template;
  return rest;
}

interface TemplateRow {
  id: string;
  user_id: string;
  kind: string;
  name: string;
  summary: string;
  document: unknown;
  source_template: string | null;
  revision: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toTemplate(row: TemplateRow): SavedTemplate {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as TemplateKind,
    name: row.name,
    summary: row.summary,
    document: (typeof row.document === 'string' ? JSON.parse(row.document) : row.document) as Record<string, unknown>,
    sourceTemplate: row.source_template,
    revision: Number(row.revision ?? 1),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const MAX_NAME = 120;
const MAX_SUMMARY = 400;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

/** Normalise and validate the caller-supplied metadata. Throws a 400 with a usable message. */
export function normaliseTemplateInput(input: {
  kind?: unknown;
  name?: unknown;
  summary?: unknown;
  document?: unknown;
  sourceTemplate?: unknown;
}): { kind: TemplateKind; name: string; summary: string; document: Record<string, unknown>; sourceTemplate: string | null } {
  const kind = String(input.kind ?? '');
  if (!TEMPLATE_KINDS.includes(kind as TemplateKind)) {
    throw new ValidationError(`Template kind must be one of ${TEMPLATE_KINDS.join(', ')}.`);
  }
  const name = String(input.name ?? '').trim();
  if (name.length < 1) throw new ValidationError('Give the template a name.');
  if (name.length > MAX_NAME) throw new ValidationError(`Template names are limited to ${MAX_NAME} characters.`);
  const summary = String(input.summary ?? '').trim().slice(0, MAX_SUMMARY);
  if (!input.document || typeof input.document !== 'object' || Array.isArray(input.document)) {
    throw new ValidationError('The template document must be an object.');
  }
  const document = input.document as Record<string, unknown>;
  const serialized = JSON.stringify(document);
  if (serialized.length > MAX_DOCUMENT_BYTES) {
    throw new ValidationError(
      `This template is ${(serialized.length / 1024).toFixed(0)} kB; templates are limited to ${(MAX_DOCUMENT_BYTES / 1024).toFixed(0)} kB. Reduce the size of any embedded images.`
    );
  }
  const sourceTemplate = typeof input.sourceTemplate === 'string' && input.sourceTemplate.trim() !== '' ? input.sourceTemplate.trim().slice(0, 96) : null;
  return { kind: kind as TemplateKind, name, summary, document, sourceTemplate };
}

export async function listTemplates(db: Queryable, userId: string, kind?: TemplateKind): Promise<TemplateListItem[]> {
  const { rows } = await db.query<TemplateRow>(
    `SELECT id, user_id, kind, name, summary, document, source_template, revision, created_at, updated_at
       FROM design_studio_templates
      WHERE user_id = $1 ${kind ? 'AND kind = $2' : ''}
      ORDER BY updated_at DESC`,
    kind ? [userId, kind] : [userId]
  );
  return rows.map((row) => {
    const { document: _document, userId: _userId, ...rest } = toTemplate(row);
    return rest;
  });
}

/** Fetch one template, scoped to its owner. Another account's template is indistinguishable from a missing one. */
export async function getTemplate(db: Queryable, userId: string, id: string): Promise<SavedTemplate> {
  const { rows } = await db.query<TemplateRow>(
    `SELECT id, user_id, kind, name, summary, document, source_template, revision, created_at, updated_at
       FROM design_studio_templates WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  const row = rows[0];
  if (!row) throw new NotFoundError('No saved template exists with that id.');
  return toTemplate(row);
}

/**
 * Create a template.
 *
 * A duplicate name for the same owner and kind is a 409 with a message that says what to do, rather
 * than a raw unique-violation. The check is done by catching the constraint error so a race between
 * two tabs cannot slip a duplicate through.
 */
export async function createTemplate(
  db: Queryable,
  userId: string,
  input: { kind?: unknown; name?: unknown; summary?: unknown; document?: unknown; sourceTemplate?: unknown }
): Promise<SavedTemplate> {
  const normalised = normaliseTemplateInput(input);
  const id = randomUUID();
  try {
    const { rows } = await db.query<TemplateRow>(
      `INSERT INTO design_studio_templates (id, user_id, kind, name, summary, document, source_template)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id, user_id, kind, name, summary, document, source_template, revision, created_at, updated_at`,
      [id, userId, normalised.kind, normalised.name, normalised.summary, JSON.stringify(normalised.document), normalised.sourceTemplate]
    );
    const row = rows[0];
    if (!row) throw new Error('The template was not saved.');
    return toTemplate(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError(`You already have a ${normalised.kind} template called “${normalised.name}”. Rename this one or update the existing template.`);
    }
    throw error;
  }
}

/**
 * Rename a template and/or change its description. Never touches the document.
 *
 * Splitting this from `overwriteTemplate` is the point of the whole lifecycle: a rename is a
 * one-field edit with no confirmation prompt, and an overwrite is destructive. If one function did
 * both, every caller would have to remember to omit `document` when renaming, and a `name`-only
 * request that also carried a document — from a stale tab, a retry, a bug — would silently replace the
 * layout. Here the document cannot be reached at all.
 *
 * `previousName` lets the caller report what changed without a second read.
 */
export async function renameTemplate(
  db: Queryable,
  userId: string,
  id: string,
  input: { name?: unknown; summary?: unknown }
): Promise<{ template: SavedTemplate; previousName: string }> {
  const existing = await getTemplate(db, userId, id);
  const name = input.name === undefined ? existing.name : String(input.name).trim();
  if (name.length < 1) throw new ValidationError('Give the template a name.');
  if (name.length > MAX_NAME) throw new ValidationError(`Template names are limited to ${MAX_NAME} characters.`);
  const summary = input.summary === undefined ? existing.summary : String(input.summary).trim().slice(0, MAX_SUMMARY);

  try {
    const { rows } = await db.query<TemplateRow>(
      `UPDATE design_studio_templates
          SET name = $3, summary = $4, updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING id, user_id, kind, name, summary, document, source_template, revision, created_at, updated_at`,
      [id, userId, name, summary]
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('No saved template exists with that id.');
    return { template: toTemplate(row), previousName: existing.name };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        `You already have a ${existing.kind} template called “${name}”. Rename this one or update the existing template.`
      );
    }
    throw error;
  }
}

/**
 * Replace a saved template's document in place, keeping its id.
 *
 * ## Why the version check is in the WHERE clause
 *
 * `expectedRevision` is the revision the client loaded. The update only matches when the row still
 * carries it, so two tabs cannot both "win": the second one matches zero rows. This is not a
 * read-then-write in TypeScript — that has a window between the read and the write in which the other
 * save lands, and the loser would still think it won.
 *
 * ## What a failed overwrite leaves behind
 *
 * Nothing. A single `UPDATE` that matches no rows does not touch the document, so a stale save, a
 * rejected name, an oversized payload or a validation error all leave the stored template exactly as
 * it was. The tests assert this by reading the template back after each failure.
 *
 * `expectedRevision` is optional for compatibility with a client that only has an id. Omitting it
 * means "overwrite whatever is there" — the behaviour before this column existed — which is why the
 * SPA always sends it: the guarantee is only as good as the caller's version number.
 */
export async function overwriteTemplate(
  db: Queryable,
  userId: string,
  id: string,
  input: { document?: unknown; summary?: unknown; expectedRevision?: unknown }
): Promise<{ template: SavedTemplate; previousRevision: number; previousName: string }> {
  const existing = await getTemplate(db, userId, id);
  if (input.document === undefined) {
    throw new ValidationError('An update must include the document to save. To change only the name, rename the template.');
  }
  if (!input.document || typeof input.document !== 'object' || Array.isArray(input.document)) {
    throw new ValidationError('The template document must be an object.');
  }
  const serialized = JSON.stringify(input.document);
  if (serialized.length > MAX_DOCUMENT_BYTES) {
    throw new ValidationError(
      `This template is ${(serialized.length / 1024).toFixed(0)} kB; templates are limited to ${MAX_DOCUMENT_BYTES / 1024} kB. Reduce the size of any embedded images.`
    );
  }
  const summary = input.summary === undefined ? existing.summary : String(input.summary).trim().slice(0, MAX_SUMMARY);

  let expected: number | null = null;
  if (input.expectedRevision !== undefined && input.expectedRevision !== null) {
    const parsed = Number(input.expectedRevision);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ValidationError('"expectedRevision" must be a whole number of at least 1 — it comes from the template you loaded.');
    }
    expected = parsed;
  }

  const { rows } = await db.query<TemplateRow>(
    `UPDATE design_studio_templates
        SET document = $3::jsonb,
            summary = $4,
            revision = revision + 1,
            updated_at = now()
      WHERE id = $1 AND user_id = $2${expected === null ? '' : ' AND revision = $5'}
      RETURNING id, user_id, kind, name, summary, document, source_template, revision, created_at, updated_at`,
    expected === null ? [id, userId, serialized, summary] : [id, userId, serialized, summary, expected]
  );
  const row = rows[0];
  if (!row) {
    // Zero rows means one of two very different things. Re-read to tell them apart: a template that is
    // gone (or not ours) is NOT_FOUND; one that is still ours but moved on is a CONFLICT the client can
    // resolve by reloading. Reporting a stale version as "not found" would make the operator think
    // they deleted their template.
    const current = await getTemplate(db, userId, id).catch(() => null);
    if (!current) throw new NotFoundError('No saved template exists with that id.');
    throw new ConflictError(
      `“${current.name}” was changed in another tab or device after you loaded it (it is now revision ${current.revision}; you had ${expected}). Reload it and try again — nothing was overwritten.`
    );
  }
  return { template: toTemplate(row), previousRevision: existing.revision, previousName: existing.name };
}

/** Copy a template under a new name ("Copy of …"), which is what the editor's Duplicate action does. */
export async function duplicateTemplate(db: Queryable, userId: string, id: string, name?: string): Promise<SavedTemplate> {
  const existing = await getTemplate(db, userId, id);
  const base = name?.trim() || `${existing.name} (copy)`;
  // Find a free name: "Copy of X", "Copy of X (2)", … so duplicating twice does not fail.
  let candidate = base;
  for (let attempt = 2; attempt <= 20; attempt += 1) {
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM design_studio_templates WHERE user_id = $1 AND kind = $2 AND lower(name) = lower($3)`,
      [userId, existing.kind, candidate]
    );
    if (rows[0]?.count === '0') break;
    candidate = `${base} (${attempt})`;
  }
  return createTemplate(db, userId, {
    kind: existing.kind,
    name: candidate,
    summary: existing.summary,
    document: existing.document,
    sourceTemplate: existing.sourceTemplate,
  });
}

export async function deleteTemplate(db: Queryable, userId: string, id: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM design_studio_templates WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  if (rows.length === 0) throw new NotFoundError('No saved template exists with that id.');
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505');
}
