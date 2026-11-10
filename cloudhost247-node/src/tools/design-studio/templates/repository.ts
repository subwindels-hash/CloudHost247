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
import { NotFoundError, ValidationError } from '../../../lib/errors';

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
  createdAt: string;
  updatedAt: string;
}

export interface TemplateListItem {
  id: string;
  kind: TemplateKind;
  name: string;
  summary: string;
  sourceTemplate: string | null;
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
    `SELECT id, user_id, kind, name, summary, document, source_template, created_at, updated_at
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
    `SELECT id, user_id, kind, name, summary, document, source_template, created_at, updated_at
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
       RETURNING id, user_id, kind, name, summary, document, source_template, created_at, updated_at`,
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

export async function updateTemplate(
  db: Queryable,
  userId: string,
  id: string,
  input: { name?: unknown; summary?: unknown; document?: unknown }
): Promise<SavedTemplate> {
  const existing = await getTemplate(db, userId, id);
  const name = input.name === undefined ? existing.name : String(input.name).trim();
  if (name.length < 1) throw new ValidationError('Give the template a name.');
  if (name.length > MAX_NAME) throw new ValidationError(`Template names are limited to ${MAX_NAME} characters.`);
  const summary = input.summary === undefined ? existing.summary : String(input.summary).trim().slice(0, MAX_SUMMARY);
  let document = existing.document;
  if (input.document !== undefined) {
    if (!input.document || typeof input.document !== 'object' || Array.isArray(input.document)) {
      throw new ValidationError('The template document must be an object.');
    }
    const serialized = JSON.stringify(input.document);
    if (serialized.length > MAX_DOCUMENT_BYTES) {
      throw new ValidationError(`This template is ${(serialized.length / 1024).toFixed(0)} kB; templates are limited to ${(MAX_DOCUMENT_BYTES / 1024).toFixed(0)} kB.`);
    }
    document = input.document as Record<string, unknown>;
  }
  try {
    const { rows } = await db.query<TemplateRow>(
      `UPDATE design_studio_templates
          SET name = $3, summary = $4, document = $5::jsonb, updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING id, user_id, kind, name, summary, document, source_template, created_at, updated_at`,
      [id, userId, name, summary, JSON.stringify(document)]
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('No saved template exists with that id.');
    return toTemplate(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError(`You already have a template called “${name}”. Rename this one.`);
    }
    throw error;
  }
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
